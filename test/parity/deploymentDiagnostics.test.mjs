import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, test } from 'vitest'
import { CONTRACT_VERSION, HELPER_VERSION } from '../../scripts/deployment-diagnostic.mjs'

const root = resolve(import.meta.dirname, '../..')
const helper = join(root, 'scripts/deployment-diagnostic.mjs')
const SHA = 'a'.repeat(40)
const DIGEST = `sha256:${'b'.repeat(64)}`
const roots = []
afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'shapepilot diagnostics-'))
  roots.push(path)
  const report = join(path, 'report.json')
  const records = join(path, 'records.jsonl')
  const env = {
    ...process.env,
    GITHUB_REPOSITORY: 'EnzoLopez2023/ShapePilot',
    GITHUB_SHA: SHA,
    GITHUB_RUN_ID: '12345',
    GITHUB_RUN_ATTEMPT: '2',
    GITHUB_JOB: 'diagnostics_candidate',
    GITHUB_REF: 'refs/heads/main',
    DIAGNOSTIC_CANDIDATE_DIGEST: DIGEST,
    IMAGE_DIGEST: `sha256:${'c'.repeat(64)}`,
    GITHUB_STEP_SUMMARY: join(path, 'summary.md'),
    GITHUB_OUTPUT: join(path, 'output'),
  }
  return {
    path, report, records, env,
    run(args, extraEnv = {}, entrypoint = helper) {
      const result = spawnSync(process.execPath, [entrypoint, ...args], {
        cwd: path, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 5_000,
      })
      assert.ifError(result.error)
      return result
    },
    record() { return JSON.parse(readFileSync(records, 'utf8').trim()) },
    context: [
      '--check', 'migration-compatibility-precheck',
      '--category', 'migration-precondition',
      '--phase', 'pre-activation',
      '--records', records,
      '--report', report,
      '--report-format', 'generic-json',
    ],
  }
}

test('the helper and composite action are unchanged deployment-diagnostics-v1 v1.0.1', () => {
  assert.equal(CONTRACT_VERSION, 'deployment-diagnostics-v1')
  assert.equal(HELPER_VERSION, '1.0.1')
  for (const [path, expected] of [
    [helper, '37f5e2d90e024836456bb5439d08bbac9bd67299ade1263ea96b2d503601b706'],
    [join(root, '.github/actions/deployment-diagnostic/action.yml'), '408cb1c1cc58d188d538023607ef27f24c34b7aba7e0ae3ddf11e23359850588'],
  ]) {
    assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), expected)
  }
})

test('retains high/critical findings and exact candidate identity without gating deployment', () => {
  const f = fixture()
  const report = JSON.stringify({ metadata: { vulnerabilities: { critical: 1, high: 2, total: 3 } } })
  writeFileSync(f.report, report)
  const result = f.run([
    'run', ...f.context, '--report-format', 'npm-audit-json',
    '--', process.execPath, '-e', 'process.exit(1)',
  ])
  assert.equal(result.status, 0, result.stderr)
  const record = f.record()
  assert.equal(record.status, 'finding')
  assert.equal(record.exit_code, 1)
  assert.equal(record.findings.count, 3)
  assert.equal(record.findings.severity.critical, 1)
  assert.equal(record.findings.severity.high, 2)
  assert.equal(record.repository, 'EnzoLopez2023/ShapePilot')
  assert.equal(record.head_sha, SHA)
  assert.equal(record.build_id, '12345-2')
  assert.equal(record.candidate_digest, DIGEST)
  assert.equal(record.control_effect, 'observable')
  assert.ok(record.evidence_paths.includes(f.report))
  assert.equal(readFileSync(f.report, 'utf8'), report)
  assert.match(result.stdout, /::warning.*finding/)
})

test('missing commands, missing reports, malformed reports and timeouts never become passes', () => {
  for (const scenario of ['command', 'missing-report', 'malformed-report', 'timeout']) {
    const f = fixture()
    if (scenario === 'malformed-report') writeFileSync(f.report, '{broken')
    else if (scenario !== 'missing-report') writeFileSync(f.report, '{}')
    const checker = scenario === 'command'
      ? ['shapepilot-nonexistent-checker-fixture']
      : [process.execPath, '-e', scenario === 'timeout' ? 'setInterval(() => {}, 1000)' : 'process.exit(0)']
    const result = f.run([
      'run', ...f.context, '--timeout', scenario === 'timeout' ? '50' : '2000', '--', ...checker,
    ])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(f.record().status, 'execution-failure', scenario)
    assert.ok(f.record().execution_error)
  }
})

test('records an unavailable exact-image SBOM as an execution failure, not a source SBOM pass', () => {
  const f = fixture()
  writeFileSync(f.report, '{"partialReport":true}')
  const result = f.run([
    'record', ...f.context, '--exit-code', '',
    '--execution-error', 'Exact-image SBOM action did not complete; no process exit code was reported.',
  ])
  assert.equal(result.status, 0)
  assert.equal(f.record().status, 'execution-failure')
  assert.equal(f.record().exit_code, null)
  assert.equal(f.record().candidate_digest, DIGEST)
  assert.equal(readFileSync(f.report, 'utf8'), '{"partialReport":true}')
})

test('rerun evidence preserves the producing build and records the observing attempt separately', () => {
  const f = fixture()
  writeFileSync(f.report, '{}')
  assert.equal(f.run(['record', ...f.context, '--exit-code', '0'], {
    DIAGNOSTIC_BUILD_ID: '12345-1',
  }).status, 0)
  const record = f.record()
  assert.equal(record.build_id, '12345-1')
  assert.equal(record.workflow.run_attempt, '2')
  assert.equal(record.candidate_digest, DIGEST)
})

test('evidence redaction and aggregation retain a nonzero checker outcome', () => {
  const f = fixture()
  writeFileSync(f.report, '{}')
  const secret = 'not-a-real-credential-diagnostic-fixture'
  const result = f.run([
    'run', ...f.context, '--', process.execPath, '-e',
    'console.error(process.env.TEST_API_KEY); process.exit(1)',
  ], { TEST_API_KEY: secret })
  assert.equal(result.status, 0)
  assert.equal(f.record().status, 'finding')
  assert.ok(f.record().redaction.replacements > 0)
  assert.doesNotMatch(readFileSync(f.records, 'utf8'), new RegExp(secret))
  assert.equal(f.run(['aggregate', '--records', f.records]).status, 0)
  const summary = JSON.parse(readFileSync(join(f.path, 'records-summary.json'), 'utf8'))
  assert.equal(summary.totals.finding, 1)
  assert.equal(summary.totals.pass, 0)
})

test('malformed invocations fail authoring checks and paths with spaces execute the real CLI', () => {
  const f = fixture()
  assert.equal(f.run(['run', ...f.context, '--check', 'INVALID', '--', process.execPath, '-e', '']).status, 2)
  writeFileSync(f.report, '{}')
  const link = join(f.path, 'helper with spaces.mjs')
  symlinkSync(helper, link)
  assert.equal(f.run(['record', ...f.context, '--exit-code', '0'], {}, link).status, 0)
  assert.equal(f.record().status, 'pass')
})
