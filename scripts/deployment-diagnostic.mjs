#!/usr/bin/env node
// deployment-diagnostic.mjs — shared non-blocking deployment diagnostics helper.
//
// Contract: https://github.com/EnzoLopez2023/azure-infra/blob/main/deployment-diagnostics/POLICY.md
// Vendor this file into an app repository at `scripts/deployment-diagnostic.mjs`
// together with `.github/actions/deployment-diagnostic/action.yml`.
//
// Subcommands
//   run       spawn a checker, capture its result, never fail the job
//   record    record the result of a checker that already ran (third-party action)
//   skip      record that a check had no prerequisite in this repository
//   aggregate summarize the record file into annotations and a job summary
//
// Every subcommand exits 0. The single exception is a malformed helper
// invocation (missing or invalid `--check`/`--category`/`--phase`), which is a
// workflow authoring defect rather than a check result and exits 2 so it is
// fixed instead of silently producing no evidence.

import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

export const HELPER_VERSION = '1.0.0';
export const CONTRACT_VERSION = 'deployment-diagnostics-v1';
export const DEFAULT_RECORD_PATH = 'deployment-diagnostics/records.jsonl';

const CATEGORIES = new Set([
  'source-audit',
  'sbom',
  'image-scan',
  'signature-provenance',
  'migration-precondition',
  'recovery-precondition',
  'readiness-precondition',
  'monitoring-precheck',
  'protected-configuration-precheck',
  'nested-checker',
]);
const PHASES = new Set(['pre-build', 'pre-activation']);
const CHECK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUMMARY_LIMIT = 2000;

const SECRET_NAME_PATTERN =
  /(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|CLIENT_KEY|CONNECTION_STRING|SAS|_PAT|^PAT$|APIKEY|API_KEY)/i;
const SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
  /\b(?:client_secret|password|sig|access_token|refresh_token)=[^\s&"']{8,}/gi,
];

export function emptySeverity() {
  return { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
}

/** Build the replacement list from the current environment without ever storing it in evidence. */
export function secretValuesFromEnv(env) {
  const values = [];
  for (const [name, value] of Object.entries(env ?? {})) {
    if (typeof value !== 'string' || value.length < 8) continue;
    if (!SECRET_NAME_PATTERN.test(name)) continue;
    values.push(value);
  }
  return values.sort((a, b) => b.length - a.length);
}

export function redact(text, secretValues = []) {
  if (typeof text !== 'string' || text.length === 0) {
    return { text: text ?? '', replacements: 0 };
  }
  let output = text;
  let replacements = 0;
  for (const secret of secretValues) {
    if (!secret) continue;
    let index = output.indexOf(secret);
    while (index !== -1) {
      output = `${output.slice(0, index)}[REDACTED]${output.slice(index + secret.length)}`;
      replacements += 1;
      index = output.indexOf(secret, index + '[REDACTED]'.length);
    }
  }
  for (const pattern of SECRET_VALUE_PATTERNS) {
    output = output.replace(pattern, () => {
      replacements += 1;
      return '[REDACTED]';
    });
  }
  return { text: output, replacements };
}

export function truncate(text, limit = SUMMARY_LIMIT) {
  if (typeof text !== 'string' || text.length <= limit) return text ?? '';
  return `${text.slice(0, limit - 15)}… [truncated]`;
}

function normalizeSeverityKey(key) {
  const value = String(key).toLowerCase();
  if (value === 'critical') return 'critical';
  if (value === 'high') return 'high';
  if (value === 'medium' || value === 'moderate') return 'medium';
  if (value === 'low' || value === 'info' || value === 'negligible') return 'low';
  return 'unknown';
}

/**
 * Parse a checker report. Returns `{ ok, severity, count, summary, error }`.
 * `ok: false` always means execution failure — never a pass.
 */
export function parseReport(format, raw) {
  const severity = emptySeverity();
  if (format === 'none') {
    return { ok: true, severity, count: 0, summary: 'no report requested' };
  }
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, severity, count: 0, summary: '', error: 'checker report is missing or empty' };
  }
  if (format === 'text') {
    return { ok: true, severity, count: 0, summary: `report captured (${raw.length} bytes)` };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      severity,
      count: 0,
      summary: '',
      error: `checker report is not valid JSON: ${error.message}`,
    };
  }

  switch (format) {
    case 'trivy-json': {
      if (!parsed || !Array.isArray(parsed.Results)) {
        return { ok: false, severity, count: 0, summary: '', error: 'trivy report has no Results array' };
      }
      let count = 0;
      for (const result of parsed.Results) {
        for (const vulnerability of result?.Vulnerabilities ?? []) {
          severity[normalizeSeverityKey(vulnerability?.Severity ?? 'unknown')] += 1;
          count += 1;
        }
      }
      return { ok: true, severity, count, summary: summarizeSeverity('vulnerabilities', count, severity) };
    }
    case 'grype-json': {
      if (!parsed || !Array.isArray(parsed.matches)) {
        return { ok: false, severity, count: 0, summary: '', error: 'grype report has no matches array' };
      }
      let count = 0;
      for (const match of parsed.matches) {
        severity[normalizeSeverityKey(match?.vulnerability?.severity ?? 'unknown')] += 1;
        count += 1;
      }
      return { ok: true, severity, count, summary: summarizeSeverity('vulnerabilities', count, severity) };
    }
    case 'npm-audit-json': {
      const buckets = parsed?.metadata?.vulnerabilities;
      if (!buckets || typeof buckets !== 'object') {
        return { ok: false, severity, count: 0, summary: '', error: 'npm audit report has no metadata.vulnerabilities' };
      }
      let count = 0;
      for (const [key, value] of Object.entries(buckets)) {
        if (key === 'total' || typeof value !== 'number') continue;
        severity[normalizeSeverityKey(key)] += value;
        count += value;
      }
      return { ok: true, severity, count, summary: summarizeSeverity('advisories', count, severity) };
    }
    case 'cyclonedx-json': {
      const components = parsed?.components;
      if (parsed?.bomFormat !== 'CycloneDX' || !Array.isArray(components)) {
        return { ok: false, severity, count: 0, summary: '', error: 'CycloneDX SBOM is malformed' };
      }
      return { ok: true, severity, count: 0, summary: `CycloneDX SBOM with ${components.length} component(s)` };
    }
    case 'spdx-json': {
      const packages = parsed?.packages;
      if (typeof parsed?.spdxVersion !== 'string' || !Array.isArray(packages)) {
        return { ok: false, severity, count: 0, summary: '', error: 'SPDX SBOM is malformed' };
      }
      return { ok: true, severity, count: 0, summary: `SPDX SBOM with ${packages.length} package(s)` };
    }
    case 'generic-json':
      return { ok: true, severity, count: 0, summary: 'report captured' };
    default:
      return { ok: false, severity, count: 0, summary: '', error: `unknown report format: ${format}` };
  }
}

function summarizeSeverity(noun, count, severity) {
  if (count === 0) return `no ${noun} reported`;
  return `${count} ${noun}: ${severity.critical} critical, ${severity.high} high, ${severity.medium} medium, ${severity.low} low, ${severity.unknown} unknown`;
}

/** Classify a checker process outcome. Crashes and signals are execution failures, not findings. */
export function classifyProcess({ spawnError, timedOut, signal, exitCode }) {
  if (spawnError) return { ok: false, error: `checker could not be started: ${spawnError}` };
  if (timedOut || exitCode === 124) return { ok: false, error: 'checker timed out' };
  if (signal) return { ok: false, error: `checker terminated by signal ${signal}` };
  if (exitCode === 126 || exitCode === 127) {
    return { ok: false, error: `checker could not be executed (exit ${exitCode})` };
  }
  return { ok: true };
}

export function buildRecord(input) {
  const {
    checkId,
    category,
    phase,
    status,
    exitCode,
    findings,
    executionError,
    startedAt,
    completedAt,
    evidencePaths,
    replacements,
    env,
  } = input;

  const record = {
    schema_version: '1.0',
    contract_version: CONTRACT_VERSION,
    producer: { name: 'deployment-diagnostic-helper', version: HELPER_VERSION },
    repository: env.GITHUB_REPOSITORY ?? 'unknown/unknown',
    head_sha: /^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? '') ? env.GITHUB_SHA : '0'.repeat(40),
    build_id: env.DIAGNOSTIC_BUILD_ID ||
      (env.GITHUB_RUN_ID ? `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT ?? '1'}` : 'local'),
    candidate_digest: /^sha256:[0-9a-f]{64}$/.test(env.DIAGNOSTIC_CANDIDATE_DIGEST ?? '')
      ? env.DIAGNOSTIC_CANDIDATE_DIGEST
      : null,
    check_id: checkId,
    category,
    phase,
    control_effect: 'observable',
    status,
    exit_code: exitCode,
    findings,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)) || 0,
    evidence_paths: evidencePaths,
    workflow: {
      run_id: env.GITHUB_RUN_ID ?? null,
      run_attempt: env.GITHUB_RUN_ATTEMPT ?? null,
      job: env.GITHUB_JOB ?? null,
      ref: env.GITHUB_REF ?? null,
    },
    redaction: { applied: true, replacements },
  };
  if (status === 'execution-failure') {
    record.execution_error = executionError || 'checker did not produce a usable result';
  } else if (executionError) {
    record.execution_error = executionError;
  }
  return record;
}

function annotate(level, title, message) {
  const escaped = String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const escapedTitle = String(title).replace(/%/g, '%25').replace(/[\r\n]/g, ' ').replace(/,/g, ' ');
  process.stdout.write(`::${level} title=${escapedTitle}::${escaped}\n`);
}

function appendStepSummary(markdown) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  try {
    appendFileSync(target, markdown);
  } catch (error) {
    annotate('warning', 'Deployment diagnostics', `could not write job summary: ${error.message}`);
  }
}

function writeOutputs(entries) {
  const target = process.env.GITHUB_OUTPUT;
  if (!target) return;
  try {
    const body = Object.entries(entries)
      .map(([key, value]) => `${key}=${String(value).replace(/[\r\n]/g, ' ')}`)
      .join('\n');
    appendFileSync(target, `${body}\n`);
  } catch {
    /* outputs are best effort */
  }
}

function appendRecord(recordPath, record) {
  const absolute = resolve(recordPath);
  mkdirSync(dirname(absolute), { recursive: true });
  appendFileSync(absolute, `${JSON.stringify(record)}\n`);
}

export function parseArgs(argv) {
  const options = { _: [], evidence: [] };
  const rest = [];
  let separatorSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (separatorSeen) {
      rest.push(token);
      continue;
    }
    if (token === '--') {
      separatorSeen = true;
      continue;
    }
    if (!token.startsWith('--')) {
      options._.push(token);
      continue;
    }
    const equalsIndex = token.indexOf('=');
    const key = equalsIndex === -1 ? token.slice(2) : token.slice(2, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : token.slice(equalsIndex + 1);
    const value = inlineValue !== undefined ? inlineValue : argv[++index];
    if (key === 'evidence') options.evidence.push(value);
    else options[key] = value;
  }
  options.command = rest;
  return options;
}

function fail(message) {
  annotate('error', 'Deployment diagnostics invocation', message);
  process.exit(2);
}

function requireCheckContext(options) {
  const checkId = options.check ?? options['check-id'];
  if (!checkId || !CHECK_ID_PATTERN.test(checkId)) {
    fail('missing or malformed --check; expected a lowercase kebab-case check id');
  }
  const category = options.category;
  if (!CATEGORIES.has(category)) {
    fail(`missing or unknown --category: ${category ?? '(none)'}`);
  }
  const phase = options.phase;
  if (!PHASES.has(phase)) {
    fail(`missing or unknown --phase: ${phase ?? '(none)'}`);
  }
  return { checkId, category, phase };
}

function readReport(reportPath) {
  try {
    return { raw: readFileSync(resolve(reportPath), 'utf8') };
  } catch (error) {
    return { raw: null, error: `checker report ${reportPath} could not be read: ${error.code ?? error.message}` };
  }
}

function finish({ options, checkId, category, phase, processOutcome, exitCode, output }) {
  const startedAt = options.__startedAt ?? new Date().toISOString();
  const completedAt = new Date().toISOString();
  const secrets = secretValuesFromEnv(process.env);
  const format = options['report-format'] ?? (options.report ? 'generic-json' : 'none');

  let status;
  let executionError = null;
  let findings = { count: 0, severity: emptySeverity(), summary: '' };
  let replacements = 0;
  const evidencePaths = [...options.evidence];
  if (options.report) evidencePaths.push(options.report);

  if (!processOutcome.ok) {
    status = 'execution-failure';
    executionError = processOutcome.error;
  } else {
    let raw = null;
    let readError = null;
    if (options.report) {
      const result = readReport(options.report);
      raw = result.raw;
      readError = result.error ?? null;
    }
    if (readError) {
      status = 'execution-failure';
      executionError = readError;
    } else {
      const parsed = parseReport(format, options.report ? raw : null);
      if (!parsed.ok) {
        status = 'execution-failure';
        executionError = parsed.error;
      } else {
        findings = { count: parsed.count, severity: parsed.severity, summary: parsed.summary };
        status = parsed.count > 0 || (exitCode !== null && exitCode !== 0) ? 'finding' : 'pass';
      }
    }
  }

  if (status !== 'pass' && output) {
    // Redact before truncating. Truncating first can split a credential across
    // the excerpt boundary, and a partial value no longer matches either the
    // exact env-value replacement or the credential-shaped patterns, so its
    // prefix would survive into the record, the annotation, and the summary.
    const redactedOutput = redact(output.trim(), secrets);
    replacements += redactedOutput.replacements;
    const excerptText = truncate(redactedOutput.text, 600);
    const detail = excerptText ? ` checker output excerpt: ${excerptText}` : '';
    if (status === 'execution-failure') executionError = `${executionError}.${detail}`;
    else findings.summary = `${findings.summary}.${detail}`;
  }

  const redactedSummary = redact(findings.summary, secrets);
  replacements += redactedSummary.replacements;
  findings.summary = truncate(redactedSummary.text);

  if (executionError) {
    const redactedError = redact(executionError, secrets);
    replacements += redactedError.replacements;
    executionError = truncate(redactedError.text);
  }

  const record = buildRecord({
    checkId,
    category,
    phase,
    status,
    exitCode,
    findings,
    executionError,
    startedAt,
    completedAt,
    evidencePaths,
    replacements,
    env: process.env,
  });

  const recordPath = options.records ?? DEFAULT_RECORD_PATH;
  try {
    appendRecord(recordPath, record);
  } catch (error) {
    annotate(
      'warning',
      `Deployment diagnostics evidence: ${checkId}`,
      `could not append the diagnostic record to ${recordPath}: ${error.message}. The check result is reported in this annotation only.`,
    );
  }

  if (status !== 'pass') {
    const detail = status === 'execution-failure' ? record.execution_error : findings.summary;
    annotate(
      'warning',
      `Deployment diagnostics: ${checkId} (${status})`,
      `${detail} — non-blocking; deferred remediation for the next build or release.`,
    );
  }

  appendStepSummary(
    `| \`${checkId}\` | ${phase} | **${status}** | ${exitCode === null ? '—' : exitCode} | ${findings.count} | ${findings.summary || record.execution_error || '—'} |\n`,
  );
  writeOutputs({ status, 'exit-code': exitCode === null ? '' : exitCode, 'record-path': recordPath });
  process.exit(0);
}

async function commandRun(options) {
  const { checkId, category, phase } = requireCheckContext(options);
  if (options.command.length === 0) {
    fail('`run` requires a checker command after `--`');
  }
  options.__startedAt = new Date().toISOString();
  const timeoutMs = Number.parseInt(options.timeout ?? '900000', 10);

  const [command, ...args] = options.command;
  process.stdout.write(`::group::Deployment diagnostic — ${checkId}\n`);
  const child = spawn(command, args, { shell: false, env: process.env });

  let output = '';
  const capture = (chunk) => {
    // Stream the checker's own output to the workflow log as well as capturing
    // it. The log is where a human reads the finding; the captured copy is what
    // gets redacted before it may enter the record.
    process.stdout.write(chunk);
    output += chunk.toString();
    if (output.length > 64_000) output = output.slice(-64_000);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  const outcome = await new Promise((resolvePromise) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 900000);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolvePromise({ spawnError: error.message, exitCode: null, signal: null, timedOut });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ spawnError: null, exitCode: code, signal, timedOut });
    });
  });

  process.stdout.write('::endgroup::\n');

  finish({
    options,
    checkId,
    category,
    phase,
    processOutcome: classifyProcess(outcome),
    exitCode: outcome.exitCode,
    output,
  });
}

function commandRecord(options) {
  const { checkId, category, phase } = requireCheckContext(options);
  options.__startedAt = options['started-at'] ?? new Date().toISOString();
  const rawExit = options['exit-code'];
  let exitCode = null;
  if (rawExit !== undefined && rawExit !== '') {
    const parsed = Number.parseInt(rawExit, 10);
    exitCode = Number.isInteger(parsed) ? Math.min(255, Math.max(-1, parsed)) : null;
  }
  const outcome =
    rawExit !== undefined && rawExit !== '' && exitCode === null
      ? { ok: false, error: `checker exit status "${rawExit}" is not an integer` }
      : classifyProcess({ spawnError: null, timedOut: false, signal: null, exitCode });
  finish({ options, checkId, category, phase, processOutcome: outcome, exitCode, output: '' });
}

function commandSkip(options) {
  const { checkId, category, phase } = requireCheckContext(options);
  const reason = options.reason ?? 'prerequisite not present in this repository';
  const now = new Date().toISOString();
  const record = buildRecord({
    checkId,
    category,
    phase,
    status: 'skipped-no-prerequisite',
    exitCode: null,
    findings: { count: 0, severity: emptySeverity(), summary: truncate(redact(reason, secretValuesFromEnv(process.env)).text) },
    executionError: null,
    startedAt: now,
    completedAt: now,
    evidencePaths: [...options.evidence],
    replacements: 0,
    env: process.env,
  });
  const recordPath = options.records ?? DEFAULT_RECORD_PATH;
  try {
    appendRecord(recordPath, record);
  } catch (error) {
    annotate('warning', `Deployment diagnostics evidence: ${checkId}`, `could not append record: ${error.message}`);
  }
  appendStepSummary(`| \`${checkId}\` | ${phase} | **skipped-no-prerequisite** | — | 0 | ${record.findings.summary} |\n`);
  writeOutputs({ status: 'skipped-no-prerequisite', 'exit-code': '', 'record-path': recordPath });
  process.exit(0);
}

export function summarizeRecords(lines) {
  const records = [];
  let malformed = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && typeof parsed.check_id === 'string') records.push(parsed);
      else malformed += 1;
    } catch {
      malformed += 1;
    }
  }
  const totals = { pass: 0, finding: 0, 'execution-failure': 0, 'skipped-no-prerequisite': 0 };
  for (const record of records) {
    if (record.status in totals) totals[record.status] += 1;
    else malformed += 1;
  }
  return { records, malformed, totals };
}

function commandAggregate(options) {
  const recordPath = options.records ?? DEFAULT_RECORD_PATH;
  let lines = [];
  let readError = null;
  try {
    lines = readFileSync(resolve(recordPath), 'utf8').split('\n');
  } catch (error) {
    readError = `${recordPath} could not be read: ${error.code ?? error.message}`;
  }

  if (readError) {
    annotate(
      'warning',
      'Deployment diagnostics aggregation',
      `${readError}. Aggregation is non-blocking; individual check annotations remain the record of this run.`,
    );
    appendStepSummary(`\n> Deployment diagnostics aggregation failed: ${readError}\n`);
    writeOutputs({ status: 'execution-failure', 'record-path': recordPath });
    process.exit(0);
  }

  const { records, malformed, totals } = summarizeRecords(lines);
  if (malformed > 0) {
    annotate(
      'warning',
      'Deployment diagnostics aggregation',
      `${malformed} diagnostic record line(s) were malformed and are reported as execution failures, not passes.`,
    );
  }

  const rows = records
    .map(
      (record) =>
        `| \`${record.check_id}\` | ${record.phase ?? '—'} | **${record.status}** | ${
          record.exit_code === null || record.exit_code === undefined ? '—' : record.exit_code
        } | ${record.findings?.count ?? 0} | ${record.findings?.summary || record.execution_error || '—'} |`,
    )
    .join('\n');

  const header = [
    '',
    '### Deployment diagnostics (non-blocking)',
    '',
    `Contract \`${CONTRACT_VERSION}\`. ${totals.pass} pass, ${totals.finding} finding, ${totals['execution-failure']} execution failure, ${totals['skipped-no-prerequisite']} skipped, ${malformed} malformed.`,
    '',
    'No result below changed whether this deployment proceeded. Findings and execution failures are deferred remediation for the next build or release.',
    '',
    '| Check | Phase | Status | Exit | Findings | Detail |',
    '|---|---|---|---|---|---|',
    rows,
    '',
  ].join('\n');
  appendStepSummary(header);

  const summaryPath = options.summary ?? recordPath.replace(/\.jsonl$/, '') + '-summary.json';
  try {
    const absolute = resolve(summaryPath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(
      absolute,
      `${JSON.stringify(
        {
          schema_version: '1.0',
          contract_version: CONTRACT_VERSION,
          generated_at: new Date().toISOString(),
          record_path: relative(process.cwd(), resolve(recordPath)),
          totals: { ...totals, malformed },
          checks: records.map((record) => ({
            check_id: record.check_id,
            phase: record.phase ?? null,
            status: record.status,
            exit_code: record.exit_code ?? null,
            findings: record.findings?.count ?? 0,
            evidence_paths: record.evidence_paths ?? [],
          })),
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    annotate('warning', 'Deployment diagnostics aggregation', `could not write ${summaryPath}: ${error.message}`);
  }

  writeOutputs({
    status: 'aggregated',
    findings: totals.finding,
    'execution-failures': totals['execution-failure'],
    malformed,
    'record-path': recordPath,
  });
  process.exit(0);
}

export async function main(argv) {
  const [subcommand, ...rest] = argv;
  const options = parseArgs(rest);
  switch (subcommand) {
    case 'run':
      return commandRun(options);
    case 'record':
      return commandRecord(options);
    case 'skip':
      return commandSkip(options);
    case 'aggregate':
      return commandAggregate(options);
    default:
      return fail(`unknown subcommand: ${subcommand ?? '(none)'}; expected run, record, skip, or aggregate`);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`;
if (invokedDirectly) {
  await main(process.argv.slice(2));
}
