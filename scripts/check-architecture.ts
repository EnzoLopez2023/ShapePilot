import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')
const failures: string[] = []
const requireCondition = (condition: boolean, message: string): void => {
  if (!condition) failures.push(message)
}

const packageJson = JSON.parse(read('package.json')) as {
  engines?: { node?: string }
  dependencies?: Record<string, string>
}
requireCondition(packageJson.engines?.node === '>=24.0.0', 'Node 24 must remain mandatory')
requireCondition(
  packageJson.dependencies?.['better-sqlite3'] === '12.4.1',
  'better-sqlite3 must remain pinned to audited version 12.4.1',
)
for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
  requireCondition(
    !/^(drizzle|pg$|postgres|postgresql|@prisma)/i.test(dependency),
    `forbidden database dependency: ${dependency}`,
  )
}

const connection = read('lib/db/connection.ts')
requireCondition(
  connection.includes("handle.pragma('journal_mode = DELETE')"),
  'SQLite connections must enforce DELETE journal mode',
)
requireCondition(
  !/journal_mode\s*=\s*WAL/i.test(connection),
  'SQLite connections must never enable WAL',
)

const dockerfile = read('Dockerfile')
const fromLines = dockerfile.match(/^FROM .+$/gm) ?? []
requireCondition(fromLines.length >= 3, 'Dockerfile must remain multi-stage')
requireCondition(
  fromLines.every((line) =>
    line.includes('node:24.17.0-bookworm-slim@sha256:862263c612aa437e3037674b85419622a9d93bff80aa1eee5398dfe686375532')
    || line === 'FROM development-dependencies AS production-dependencies'),
  'every Docker stage must use or inherit the pinned Node 24 image digest',
)
requireCondition(!/^VOLUME\s+.*\/home/im.test(dockerfile), 'Dockerfile must not shadow /home')
requireCondition(dockerfile.includes('USER node'), 'runtime image must be non-root')
requireCondition(!dockerfile.includes('npm ci --ignore-scripts'), 'npm lifecycle scripts must run')

const ciWorkflow = read('.github/workflows/ci.yml')
const deployWorkflow = ciWorkflow
const jobSections = ciWorkflow.slice(ciWorkflow.indexOf('\njobs:\n'))
  .split(/(?=^ {2}[a-z_]+:\n)/m)
const job = (name: string): string =>
  jobSections.find((section) => section.startsWith(`  ${name}:\n`)) ?? ''
requireCondition(
  deployWorkflow.includes('RG: rg-personal-apps-prod')
    && deployWorkflow.includes('ACR: acrenzolopez01')
    && deployWorkflow.includes('ACR_LOGIN_SERVER: acrenzolopez01.azurecr.io')
    && deployWorkflow.includes('IMAGE_REPOSITORY: shapepilot'),
  'deployment must remain isolated to the ShapePilot repository in the approved shared ACR',
)
requireCondition(
  !/\baz acr (?:build|import)\b/.test(deployWorkflow),
  'deployment must not require shared-ACR Tasks, Data Importer, or Contributor rights',
)
requireCondition(
  (deployWorkflow.match(/uses: docker\/build-push-action@/g) ?? []).length === 1
    && deployWorkflow.includes('docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8')
    && deployWorkflow.includes('docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f')
    && !/\bdocker (?:build|buildx build)\b/.test(deployWorkflow)
    && deployWorkflow.includes('docker push "$candidate"')
    && deployWorkflow.includes('deploy:acr-check')
    && deployWorkflow.includes('deploy:rbac-check')
    && deployWorkflow.includes('published_digest')
    && !deployWorkflow.includes('expected-sibling-fingerprint'),
  'deployment must build one cached runner image and verify only the immutable ShapePilot image',
)
requireCondition(
  deployWorkflow.includes('publish_image_only')
    && deployWorkflow.includes(
      'VITE_API_SCOPE=api://60b0b8cf-f1e2-4ba4-b89b-7d6dc3358251/access_as_user',
    ),
  'deployment must retain Web-App-independent publication and the literal API scope',
)
requireCondition(
  !/^\s*environment:/m.test(deployWorkflow),
  'branch-scoped production OIDC must not be replaced by a GitHub Environment',
)
const deploymentSafety = read('scripts/check-deploy-monitor.ts')
requireCondition(
  !/app-insights|webtests|availabilityResults/i.test(deploymentSafety)
    && deploymentSafety.includes('Microsoft.Insights/metricAlerts')
    && deploymentSafety.includes('Microsoft.Insights/scheduledQueryRules')
    && deploymentSafety.includes('smartDetectorAlertRules')
    && deploymentSafety.includes("'/version.json'")
    && deploymentSafety.includes("'/api/version'"),
  'deployment safety must use direct endpoints and preserve the owned-alert invariant',
)
const deploymentRbac = read('scripts/check-deploy-rbac.ts')
requireCondition(
  deploymentRbac.includes("'--scope', scope")
    && !deploymentRbac.includes("'--all'"),
  'deployment RBAC checks must remain inside RG-authorized exact scopes',
)
requireCondition(
  ciWorkflow.includes('AAD_TENANT_ID=$TEST_TENANT_ID')
    && ciWorkflow.includes('SHAPEPILOT_INITIALIZE_EMPTY_DB=1')
    && ciWorkflow.includes('EMPTY_SEED_DOMAIN_TABLES'),
  'Linux CI must exercise the real production empty-seed and restart path',
)
requireCondition(
  ciWorkflow.includes('pull_request:')
    && job('publish').includes('needs: [quality, container]')
    && job('deploy').includes('needs: publish')
    && ciWorkflow.includes("github.ref == 'refs/heads/main'")
    && !job('quality').includes('id-token: write')
    && !job('container').includes('id-token: write')
    && job('deploy').includes('id-token: write'),
  'the single workflow must gate main deployment on pull-request CI without weakening OIDC',
)
requireCondition(
  ['quality', 'container', 'publish', 'deploy'].every((name) =>
    !/^ {4}needs:.*diagnostics/m.test(job(name))
    && !job(name).includes('uses: ./.github/actions/deployment-diagnostic'))
    && job('quality').includes('run: npm run ci:source')
    && !job('container').includes('needs:')
    && !job('deploy').includes('npm ci')
    && !job('deploy').includes('npm run ci')
    && job('diagnostics_candidate').includes('DIAGNOSTIC_CANDIDATE_DIGEST:')
    && job('diagnostics_candidate').includes('deploy:monitor-check'),
  'diagnostic findings must stay observable outside the single-build deployment critical path',
)
requireCondition(
  !/^concurrency:/m.test(ciWorkflow)
    && job('deploy').includes('group: deploy-shapepilot')
    && job('deploy').includes('cancel-in-progress: false')
    && job('deploy').includes('queue: max')
    && job('deploy').includes('git ls-remote --exit-code origin refs/heads/main')
    && !job('deploy').includes('OFFHOST_BACKUP_'),
  'only production mutation may serialize, stale candidates must fail, and off-host backups must not gate deploys',
)
requireCondition(
  deployWorkflow.includes("ROLLBACK_MAX_ATTEMPTS: '120'")
    && job('deploy').includes("timeout --signal=TERM --kill-after=5s 595s bash <<'CANDIDATE'")
    && job('deploy').includes("timeout --signal=TERM --kill-after=5s 235s bash <<'ROLLBACK'")
    && job('deploy').includes("timeout --signal=TERM --kill-after=5s 235s bash <<'INITIAL_ROLLBACK'")
    && deployWorkflow.includes('failed-initial-stop-proof='),
  'candidate and rollback must have absolute ten/four-minute bounds and process-absence proof',
)

for (const directory of ['server', 'src']) {
  const pending = [join(root, directory)]
  while (pending.length > 0) {
    const current = pending.pop() as string
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        requireCondition(
          !readFileSync(path, 'utf8').includes("from 'better-sqlite3'"),
          `${path.slice(root.length + 1)} bypasses the repository boundary`,
        )
      }
    }
  }
}

const workflowDirectory = join(root, '.github', 'workflows')
const workflowFiles = readdirSync(workflowDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
  .map((entry) => entry.name)
requireCondition(
  workflowFiles.length === 1 && workflowFiles[0] === 'ci.yml',
  'CI and production deployment must remain consolidated in one ci.yml workflow',
)
for (const workflowFile of workflowFiles) {
  const workflow = readFileSync(join(workflowDirectory, workflowFile), 'utf8')
  for (const match of workflow.matchAll(/^\s*uses:\s*([^\s#]+)@([^\s#]+)/gm)) {
    if (match[1].startsWith('./')) continue
    requireCondition(
      /^[0-9a-f]{40}$/.test(match[2]),
      `${workflowFile} action ${match[1]} is not pinned by commit`,
    )
  }
  requireCondition(
    !/continue-on-error:\s*true/.test(workflow),
    `${workflowFile} weakens a gate with continue-on-error`,
  )
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`architecture check: ${failure}`)
  process.exitCode = 1
} else {
  console.log(JSON.stringify({
    status: 'ok',
    node: packageJson.engines?.node,
    sqlite: packageJson.dependencies?.['better-sqlite3'],
    journalMode: 'DELETE',
  }))
}
