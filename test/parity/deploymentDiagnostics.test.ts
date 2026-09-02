import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, test } from 'vitest'
import {
  classifyProcess,
  CONTRACT_VERSION,
  parseReport,
  redact,
} from '../../scripts/deployment-diagnostic.mjs'
import {
  evaluateProtectedConfiguration,
  evaluateRecovery,
} from '../../scripts/check-deployment-preconditions.ts'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string): Buffer => readFileSync(resolve(root, path))
const workflow = read('.github/workflows/ci.yml').toString('utf8')

function gitBlob(bytes: Buffer): string {
  return createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest('hex')
}

function step(name: string): string {
  const marker = `      - name: ${name}\n`
  const start = workflow.indexOf(marker)
  assert.notEqual(start, -1, `missing workflow step: ${name}`)
  const end = workflow.indexOf('\n      - name:', start + marker.length)
  return workflow.slice(start, end === -1 ? undefined : end)
}

describe('deployment-diagnostics-v1 vendoring', () => {
  test('pins the reviewed source and vendors both templates byte-exactly', () => {
    const helper = read('scripts/deployment-diagnostic.mjs')
    const action = read('.github/actions/deployment-diagnostic/action.yml')
    const provenance = JSON.parse(
      read('deployment-diagnostics/provenance.json').toString('utf8'),
    ) as {
      contractVersion: string
      source: { repository: string; pullRequest: number; commit: string }
      vendoredFiles: Array<{ targetPath: string; gitBlob: string }>
    }

    assert.equal(CONTRACT_VERSION, 'deployment-diagnostics-v1')
    assert.deepEqual(provenance.source, {
      repository: 'EnzoLopez2023/azure-infra',
      pullRequest: 24,
      commit: 'f45790e9df7c9fabbc53dd04e6055a59d6f28f39',
    })
    assert.equal(provenance.contractVersion, CONTRACT_VERSION)
    assert.deepEqual(
      Object.fromEntries(provenance.vendoredFiles.map((file) => [
        file.targetPath,
        file.gitBlob,
      ])),
      {
        'scripts/deployment-diagnostic.mjs':
          'd31a00faad5832832bf0b91e96387f5f77645700',
        '.github/actions/deployment-diagnostic/action.yml':
          'ff7330e29f4f15abe61bf8c4f5520ff5f1674fc4',
      },
    )
    assert.equal(gitBlob(helper), 'd31a00faad5832832bf0b91e96387f5f77645700')
    assert.equal(gitBlob(action), 'ff7330e29f4f15abe61bf8c4f5520ff5f1674fc4')
  })

  test('never fabricates a pass for missing reports or checker execution failures', () => {
    assert.equal(parseReport('trivy-json', '').ok, false)
    assert.equal(parseReport('trivy-json', '{}').ok, false)
    assert.equal(parseReport('spdx-json', '{}').ok, false)
    assert.equal(classifyProcess({
      spawnError: 'ENOENT',
      timedOut: false,
      signal: null,
      exitCode: null,
    }).ok, false)
    assert.equal(classifyProcess({
      spawnError: null,
      timedOut: true,
      signal: 'SIGKILL',
      exitCode: null,
    }).ok, false)
    assert.equal(classifyProcess({
      spawnError: null,
      timedOut: false,
      signal: null,
      exitCode: 1,
    }).ok, true)
  })

  test('redacts secret values before they can reach diagnostic text', () => {
    const secret = 'secret-value-that-must-not-survive'
    const result = redact(`before ${secret} after`, [secret])
    assert.equal(result.text, 'before [REDACTED] after')
    assert.equal(result.replacements, 1)
  })
})

describe('ShapePilot diagnostic reports', () => {
  test('records a deterministic migration finding without gating', () => {
    const directory = mkdtempSync(join(tmpdir(), 'shapepilot-deployment-precheck-'))
    const reportPath = join(directory, 'migration.json')
    const recordsPath = join(directory, 'records.jsonl')
    try {
      const result = spawnSync(process.execPath, [
        'scripts/deployment-diagnostic.mjs',
        'run',
        '--check', 'migration-compatibility-precheck',
        '--category', 'migration-precondition',
        '--phase', 'pre-activation',
        '--report', reportPath,
        '--report-format', 'generic-json',
        '--records', recordsPath,
        '--',
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(process.argv[1], '${
          JSON.stringify({ ok: false, detail: 'fixture incompatibility' })
        }\\n'); process.exit(1)`,
        reportPath,
      ], {
        cwd: root,
        encoding: 'utf8',
      })
      assert.equal(result.status, 0, result.stderr)
      const record = JSON.parse(readFileSync(recordsPath, 'utf8')) as {
        check_id: string
        status: string
        exit_code: number
      }
      assert.equal(record.check_id, 'migration-compatibility-precheck')
      assert.equal(record.status, 'finding')
      assert.equal(record.exit_code, 1)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('reports protected configuration by setting name without retaining values', () => {
    const secret = 'resolved-production-secret-value'
    const report = evaluateProtectedConfiguration(
      [{ name: 'AZURE_OPENAI_API_KEY', value: secret }],
      {
        alwaysOn: true,
        numberOfWorkers: 1,
        healthCheckPath: '/api/live',
        acrUseManagedIdentityCreds: true,
        linuxFxVersion:
          `DOCKER|acrenzolopez01.azurecr.io/shapepilot@sha256:${'a'.repeat(64)}`,
      },
    )
    const serialized = JSON.stringify(report)
    assert.equal(report.ok, false)
    assert.ok(!serialized.includes(secret))
    assert.ok(serialized.includes('AZURE_OPENAI_API_KEY'))
    assert.ok(!serialized.includes('@Microsoft.KeyVault'))
  })

  test('keeps missing backup freshness visible as a recovery finding', () => {
    const report = evaluateRecovery(
      [],
      {
        status: 'ready',
        lifecycle: 'ready',
        database: {
          authority: '/home/data/shapepilot.db',
          reachable: true,
          journalMode: 'DELETE',
          foreignKeys: true,
          schemaIdentity: 'schema',
          expectedSchemaIdentity: 'schema',
          headMigration: '005-keycap-projects',
          expectedHeadMigration: '005-keycap-projects',
        },
      },
    )
    assert.equal(report.ok, false)
    assert.equal(report.off_host_backup_freshness, 'not-observable')
    assert.match(report.detail, /recovery setting names/)
  })
})

describe('deployment workflow diagnostics contract', () => {
  test('invokes every full-profile check and both aggregators through the helper', () => {
    const checkIds = [...workflow.matchAll(/^\s+check-id: ([a-z0-9-]+)$/gm)]
      .map((match) => match[1])
    const counts = new Map<string, number>()
    for (const checkId of checkIds) {
      counts.set(checkId, (counts.get(checkId) ?? 0) + 1)
    }

    assert.deepEqual([...counts.keys()].sort(), [
      'aggregate',
      'image-sbom',
      'image-vulnerability-scan',
      'migration-compatibility-precheck',
      'monitoring-precheck',
      'protected-configuration-precheck',
      'provenance-attestation-verification',
      'readiness-precondition-precheck',
      'recovery-precondition-precheck',
      'signature-verification',
      'source-dependency-audit',
      'source-sbom',
    ])
    for (const checkId of [
      'aggregate',
      'protected-configuration-precheck',
      'readiness-precondition-precheck',
      'recovery-precondition-precheck',
      'source-dependency-audit',
      'source-sbom',
    ]) {
      assert.equal(counts.get(checkId), 2, `${checkId} invocation count`)
    }
    assert.equal(
      workflow.match(/uses: \.\/\.github\/actions\/deployment-diagnostic/g)?.length,
      18,
    )
  })

  test('preserves dependency and scanner strength on exact candidate inputs', () => {
    const fullAudit = step('Diagnostic - audit full dependency tree')
    const productionAudit = step('Diagnostic - audit production dependency tree')
    assert.match(fullAudit, /npm audit --audit-level=high --json/)
    assert.match(productionAudit, /npm audit --omit=dev --audit-level=high --json/)

    const imageSbom = step('Generate exact-image SBOM')
    assert.match(
      imageSbom,
      /anchore\/sbom-action@e22c389904149dbc22b58101806040fa8d37a610/,
    )
    assert.match(imageSbom, /image: \$\{\{ steps\.image\.outputs\.ref \}\}/)
    assert.match(imageSbom, /format: spdx-json/)
    assert.match(imageSbom, /continue-on-error: true/)
    assert.match(imageSbom, /timeout-minutes: 10/)

    const imageScan = step('Scan exact image for HIGH and CRITICAL vulnerabilities')
    assert.match(
      imageScan,
      /aquasecurity\/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25/,
    )
    assert.match(imageScan, /severity: HIGH,CRITICAL/)
    assert.match(imageScan, /ignore-unfixed: false/)
    assert.match(imageScan, /scanners: vuln/)
    assert.match(imageScan, /timeout: 10m/)
    assert.match(imageScan, /timeout-minutes: 12/)
    assert.match(imageScan, /exit-code: '0'/)
    assert.ok(!/\.trivyignore|--ignorefile|--skip-scan/.test(workflow))
  })

  test('keeps operations, activation, post-activation verification, and rollback blocking', () => {
    for (const name of [
      'Checkout exact source',
      'Set up Node',
      'Install exact deployment dependencies',
      'Run blocking deployment validation',
      'Azure login with OIDC',
      'Verify shared ACR and deployment RBAC',
      'Verify runtime deployment identity',
      'Build and inspect unique immutable candidate',
      'Verify immutable ShapePilot image before activation',
      'Activate inspected digest as production canary',
      'Verify candidate version, liveness, and readiness',
      'Confirm promoted release and monitoring',
      'Restore prior release after failure or cancellation',
      'Stop failed first-release candidate',
    ]) {
      assert.ok(!step(name).includes('continue-on-error:'), `${name} must block`)
    }

    assert.match(
      step('Activate inspected digest as production canary'),
      /az webapp config container set/,
    )
    assert.match(
      step('Confirm promoted release and monitoring'),
      /npm run deploy:monitor-check/,
    )
    assert.match(
      step('Restore prior release after failure or cancellation'),
      /npm run deploy:monitor-check/,
    )
  })

  test('removes pre-deployment check verdicts from blocking mixed steps', () => {
    assert.ok(!/npm audit|npm sbom|deploy:migration-check/.test(
      step('Run blocking deployment validation'),
    ))
    assert.ok(!step('Verify shared ACR and deployment RBAC')
      .includes('deploy:monitor-check'))
    assert.ok(!step('Capture prior release and rollback baselines')
      .includes('verify-deployment.mjs'))
    assert.ok(!step('Capture prior release and rollback baselines').includes('curl '))
    assert.match(
      step('Preload rollback image before production mutation'),
      /org\.opencontainers\.image\.revision/,
    )
    assert.match(
      step('Preload rollback image before production mutation'),
      /org\.opencontainers\.image\.version/,
    )
    assert.match(
      step('Verify candidate version, liveness, and readiness'),
      /\$\{PREVIOUS_INSTANCE_ID:-\}/,
    )
  })

  test('allows continue-on-error only for diagnostic producers and uploads', () => {
    const continued = workflow
      .split(/(?=^\s{6}- name: )/m)
      .filter((candidate) => /^\s{8}continue-on-error:\s*true\s*$/m.test(candidate))
      .map((candidate) => /^\s{6}- name: (.+)$/m.exec(candidate)?.[1])
      .sort()
    assert.deepEqual(continued, [
      'Generate exact-image SBOM',
      'Install Cosign for diagnostic verification',
      'Scan exact image for HIGH and CRITICAL vulnerabilities',
      'Upload deployment diagnostic evidence',
      'Upload quality deployment diagnostic evidence',
    ])
    for (const name of continued) {
      assert.match(step(name as string), /timeout-minutes: [1-9][0-9]*/)
    }
  })

  test('aggregates and uploads evidence best-effort with an explicit warning', () => {
    for (const name of [
      'Aggregate quality deployment diagnostics',
      'Aggregate deployment diagnostics',
    ]) {
      const aggregate = step(name)
      assert.match(aggregate, /if: \$\{\{ always\(\) \}\}/)
      assert.match(aggregate, /mode: aggregate/)
    }
    for (const name of [
      'Upload quality deployment diagnostic evidence',
      'Upload deployment diagnostic evidence',
    ]) {
      const upload = step(name)
      assert.match(upload, /if: \$\{\{ always\(\) \}\}/)
      assert.match(upload, /continue-on-error: true/)
      assert.match(upload, /timeout-minutes: 5/)
      assert.match(upload, /retention-days: 30/)
      assert.match(upload, /deployment-diagnostics\//)
    }
    assert.match(
      step('Warn if deployment diagnostic evidence upload failed'),
      /::warning title=Deployment diagnostics upload::/,
    )
  })

  test('emits explicit warning annotations for every legitimate skipped prerequisite', () => {
    for (const name of [
      'Warn that protected configuration diagnostic was skipped',
      'Warn that readiness diagnostic was skipped',
      'Warn that recovery diagnostic was skipped',
    ]) {
      assert.match(step(name), /::warning title=Deployment diagnostic skipped/)
      assert.ok(!step(name).includes('continue-on-error:'))
    }
  })

  test('runs readiness after rollback metadata is prepared and before activation is armed', () => {
    const preload = workflow.indexOf('- name: Preload rollback image before production mutation')
    const readiness = workflow.indexOf('- name: Diagnostic - pre-activation readiness')
    const arm = workflow.indexOf('- name: Arm rollback before production mutation')
    assert.ok(preload < readiness)
    assert.ok(readiness < arm)
  })
})
