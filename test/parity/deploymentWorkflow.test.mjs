import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, test } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const commands = readFileSync(join(root, 'test/fixtures/deployment-commands.sh'), 'utf8')
const sections = workflow.slice(workflow.indexOf('\njobs:\n'))
  .split(/(?=^ {2}[a-z_]+:\n)/m)
const job = (name) => {
  const section = sections.find((value) => value.startsWith(`  ${name}:\n`))
  assert.ok(section, `missing job ${name}`)
  return section
}
const steps = (name) => job(name).split(/(?=^ {6}- name: )/m).slice(1)
const step = (name, title) => {
  const value = steps(name).find((section) => section.startsWith(`      - name: ${title}\n`))
  assert.ok(value, `missing step ${name}/${title}`)
  return value
}
const shell = (name, title) => {
  const match = step(name, title).match(/^ {8}run: \|\n([\s\S]+)$/m)
  assert.ok(match, `missing shell ${name}/${title}`)
  return match[1].replace(/^ {10}/gm, '')
}
const needs = (name) => {
  const match = job(name).match(/^ {4}needs: (.+)$/m)
  return match ? match[1].replace(/[[\]\s]/g, '').split(',') : []
}

const CANDIDATE = 'Activate and confirm the inspected digest within ten minutes'
const ROLLBACK = 'Restore prior release after failure or cancellation'
const INITIAL_ROLLBACK = 'Stop failed first-release candidate'
const SHA = 'a'.repeat(40)
const DIGEST = `sha256:${'d'.repeat(64)}`
const PREVIOUS_DIGEST = `sha256:${'b'.repeat(64)}`
const ACR_SERVER = 'acrenzolopez01.azurecr.io'
const REPOSITORY = `${ACR_SERVER}/shapepilot`
const roots = []

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

function execute(name, title, overrides = {}) {
  const path = mkdtempSync(join(tmpdir(), 'shapepilot-workflow-'))
  roots.push(path)
  mkdirSync(join(path, 'evidence'))
  const files = {
    TRACE: join(path, 'trace'),
    STATE_FILE: join(path, 'state'),
    CONFIG_FILE: join(path, 'config'),
    LATEST_FILE: join(path, 'latest'),
    TAGGED_FILE: join(path, 'tagged'),
    CLOCK_FILE: join(path, 'clock'),
    GITHUB_ENV: join(path, 'env'),
    GITHUB_OUTPUT: join(path, 'output'),
  }
  for (const file of Object.values(files)) writeFileSync(file, '')
  writeFileSync(files.STATE_FILE, 'Running')
  writeFileSync(files.CONFIG_FILE, `${REPOSITORY}@${PREVIOUS_DIGEST}`)
  writeFileSync(files.LATEST_FILE, overrides.INITIAL_DEPLOYMENT === 'true' ? DIGEST : PREVIOUS_DIGEST)
  const result = spawnSync('bash', ['-c', `${commands}\n${shell(name, title)}`], {
    cwd: path,
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      ...files,
      GITHUB_REPOSITORY: 'EnzoLopez2023/ShapePilot',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: SHA,
      GITHUB_RUN_ID: '12345',
      GITHUB_RUN_ATTEMPT: '2',
      BUILD_ID: '12345-2',
      IMAGE: `shapepilot-ci:${SHA}-12345-2`,
      SMOKE_TESTED_IMAGE_ID: `sha256:${'e'.repeat(64)}`,
      RUNNER_TEMP: path,
      AZURE_CLIENT_ID: '11111111-1111-4111-8111-111111111111',
      VITE_AZURE_CLIENT_ID: '60b0b8cf-f1e2-4ba4-b89b-7d6dc3358251',
      IMAGE_DIGEST: DIGEST,
      IMAGE_REFERENCE: `${REPOSITORY}@${DIGEST}`,
      PREVIOUS_IMAGE_REFERENCE: `${REPOSITORY}@${PREVIOUS_DIGEST}`,
      PREVIOUS_LATEST_DIGEST: PREVIOUS_DIGEST,
      PREVIOUS_HEALTH_SHA: 'b'.repeat(40),
      PREVIOUS_BUILD_ID: '12344-1',
      INITIAL_IMAGE_REFERENCE: `${REPOSITORY}@sha256:${'c'.repeat(64)}`,
      INITIAL_DEPLOYMENT: 'false',
      PUBLISH_IMAGE_ONLY: 'false',
      ROLLBACK_CANCELLED: 'false',
      ACR: 'acrenzolopez01',
      ACR_LOGIN_SERVER: ACR_SERVER,
      IMAGE_REPOSITORY: 'shapepilot',
      RG: 'rg-personal-apps-prod',
      WEBAPP: 'app-shapepilot-prod-lwxhu7jxlrbtu',
      PRODUCTION_URL: 'https://app-shapepilot-prod-lwxhu7jxlrbtu.azurewebsites.net',
      LIVE_PATH: '/api/live',
      READY_PATH: '/api/ready',
      DEPLOYMENT_PROFILE: 'sqlite-one-worker',
      DEPLOYMENT_CONTRACT_VERSION: 'p1-11-v1',
      REQUIRED_CONFIRMATIONS: '3',
      MAX_ATTEMPTS: '120',
      ROLLBACK_MAX_ATTEMPTS: '120',
      POLL_INTERVAL_SECONDS: '5',
      HTTP_TIMEOUT_SECONDS: '8',
      APP_SETTINGS_FINGERPRINT: 'fixture-fingerprint',
      SITE_INVARIANTS_FINGERPRINT: 'fixture-fingerprint',
      MUTATION_START_DEADLINE_EPOCH: String(Math.floor(Date.now() / 1000) + 900),
      ...overrides,
    },
  })
  assert.ifError(result.error)
  return {
    ...result,
    trace: readFileSync(files.TRACE, 'utf8'),
    configured: readFileSync(files.CONFIG_FILE, 'utf8').trim(),
    latest: readFileSync(files.LATEST_FILE, 'utf8').trim(),
    exportedEnv: readFileSync(files.GITHUB_ENV, 'utf8'),
  }
}

describe('lean deployment topology', () => {
  test('source quality and the single image build run independently and both gate publication', () => {
    assert.deepEqual(needs('quality'), [])
    assert.deepEqual(needs('container'), [])
    assert.deepEqual(needs('publish'), ['quality', 'container'])
    assert.deepEqual(needs('deploy'), ['publish'])
    for (const name of ['quality', 'container', 'publish', 'deploy']) {
      assert.ok(needs(name).every((dependency) => !dependency.startsWith('diagnostics_')))
      assert.doesNotMatch(job(name), /deployment-diagnostic|npm audit|npm sbom|deploy:(?:monitor|migration|acr|rbac)-check/)
    }
    assert.match(job('quality'), /run: npm run ci:source/)
    assert.doesNotMatch(job('deploy'), /npm ci|npm run ci|docker build/)
    assert.equal(
      packageJson.scripts['ci:source'],
      'npm run check:icons && npm run check:filaments && npm run check:architecture && npm run typecheck && npm run lint && npm test',
    )
    assert.equal(packageJson.scripts.ci, 'npm run ci:source && npm run build')
  })

  test('one pinned cached build produces the exact image transferred to the publisher', () => {
    assert.equal((workflow.match(/uses: docker\/build-push-action@/g) ?? []).length, 1)
    assert.match(job('container'), /docker\/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8/)
    assert.match(job('container'), /docker\/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f/)
    assert.match(job('container'), /platforms: linux\/amd64/)
    assert.match(job('container'), /load: true/)
    assert.match(job('container'), /cache-from: type=gha,scope=shapepilot-linux-amd64/)
    assert.match(job('container'), /cache-to: type=gha,mode=max,scope=shapepilot-linux-amd64/)
    assert.ok(job('container').indexOf('Smoke native SQLite') < job('container').indexOf('docker save'))
    assert.match(job('container'), /artifact_name=candidate-image-\$GITHUB_SHA-\$BUILD_ID/)
    assert.match(job('publish'), /name: \$\{\{ needs\.container\.outputs\.artifact_name \}\}/)
    assert.match(job('publish'), /BUILD_ID: \$\{\{ needs\.container\.outputs\.build_id \}\}/)
    assert.match(job('publish'), /SMOKE_TESTED_IMAGE_ID: \$\{\{ needs\.container\.outputs\.image_id \}\}/)
    assert.equal((job('publish').match(/!= "\$SMOKE_TESTED_IMAGE_ID"/g) ?? []).length, 2)
    assert.doesNotMatch(workflow, /\baz acr (?:build|import)\b|\bdocker (?:build|buildx build)\b/)
    assert.equal((dockerfile.match(/RUN npm ci /g) ?? []).length, 1)
    assert.match(dockerfile, /FROM development-dependencies AS production-dependencies/)
    assert.match(dockerfile, /npm prune --omit=dev --ignore-scripts --no-audit --no-fund/)
    assert.match(dockerfile, /COPY --chown=node:node --from=production-dependencies \/app\/native\/build/)
  })

  test('diagnostics keep their check strength, raw reports, digest identity and always-run summaries', () => {
    assert.deepEqual(needs('diagnostics_source'), [])
    assert.deepEqual(needs('diagnostics_candidate'), ['publish'])
    assert.match(job('diagnostics_source'), /npm audit --audit-level=high --json/)
    assert.match(job('diagnostics_source'), /npm audit --omit=dev --audit-level=high --json/)
    assert.match(job('diagnostics_source'), /npm sbom --package-lock-only --sbom-format=cyclonedx/)
    const diagnostics = job('diagnostics_candidate')
    assert.match(diagnostics, /DIAGNOSTIC_CANDIDATE_DIGEST: \$\{\{ needs\.publish\.outputs\.digest \}\}/)
    assert.match(diagnostics, /DIAGNOSTIC_BUILD_ID: \$\{\{ needs\.publish\.outputs\.build_id \}\}/)
    assert.match(diagnostics, /docker run --rm "\$IMAGE_REFERENCE" \\\n\s+node scripts\/check-deploy-migration\.ts/)
    assert.match(diagnostics, /anchore\/sbom-action@e22c389904149dbc22b58101806040fa8d37a610/)
    assert.match(step('diagnostics_candidate', 'Generate exact-image SBOM'), /steps\.diagnostic-image\.outcome == 'success'/)
    assert.match(step('diagnostics_candidate', 'Record exact-image SBOM outcome'), /mode: record/)
    assert.match(step('diagnostics_candidate', 'Record exact-image SBOM outcome'), /'success' && '0' \|\| ''/)
    assert.match(step('diagnostics_candidate', 'Record exact-image SBOM outcome'), /execution-error:.*no process exit code was reported/)
    for (const name of ['diagnostics_source', 'diagnostics_candidate']) {
      for (const section of steps(name).filter((value) => /deployment-diagnostic|Upload .*diagnostic evidence/.test(value))) {
        assert.match(section, /if: \$\{\{ always\(\) \}\}/)
      }
      assert.match(job(name), /deployment-diagnostics\/\n\s+reports\//)
      assert.match(job(name), /retention-days: 30/)
    }
    assert.doesNotMatch(workflow, /mode: skip|continue-on-error:|exit-code: '0'|cosign|trivy/)
  })

  test('only production mutation locks; OIDC remains main-branch scoped with no PR credentials', () => {
    assert.doesNotMatch(workflow, /^concurrency:|^\s*environment:/m)
    assert.equal((workflow.match(/concurrency:/g) ?? []).length, 1)
    assert.match(job('deploy'), /group: deploy-shapepilot\n\s+cancel-in-progress: false/)
    assert.match(job('deploy'), /queue: max/)
    assert.doesNotMatch(workflow, /paths-ignore:/)
    assert.doesNotMatch(job('quality') + job('container'), /id-token: write/)
    for (const name of ['publish', 'deploy', 'diagnostics_candidate']) {
      assert.match(job(name), /github\.ref == 'refs\/heads\/main'/)
      assert.match(job(name), /github\.event_name != 'pull_request'/)
    }
    assert.doesNotMatch(workflow, /contents: write|AZURE_CREDENTIALS|--slot\b|slot swap|OFFHOST_BACKUP_/)
  })

  test('hard budgets wrap the whole candidate and both rollback paths, not just polling', () => {
    assert.match(job('deploy'), /timeout-minutes: 30/)
    assert.match(job('deploy'), /MUTATION_START_DEADLINE_EPOCH=.* \+ 900 /)
    for (const [title, seconds, terminator] of [
      [CANDIDATE, 595, 'CANDIDATE'],
      [ROLLBACK, 235, 'ROLLBACK'],
      [INITIAL_ROLLBACK, 235, 'INITIAL_ROLLBACK'],
    ]) {
      const script = shell('deploy', title)
      assert.match(script, new RegExp(`timeout --signal=TERM --kill-after=5s ${seconds}s bash <<'${terminator}'`))
      assert.ok(script.trimEnd().endsWith(terminator))
      assert.ok(script.indexOf('timeout --') < script.indexOf('az webapp stop'))
      assert.match(script, /"\$state" == "Stopped" && ! "\$status" =~ \^2/)
      assert.match(script, /"\$absent_rounds" -ge 3/)
    }
    for (const title of [ROLLBACK, INITIAL_ROLLBACK]) {
      assert.match(step('deploy', title), /always\(\).*failure\(\) \|\| cancelled\(\)/)
      assert.match(step('deploy', title), /env\.DEPLOYMENT_MUTATED == 'true'/)
    }
    assert.doesNotMatch(
      step('deploy', 'Capture prior release and protected configuration'),
      /curl|verify-deployment|PREVIOUS_INSTANCE_ID/,
    )
    assert.match(job('deploy'), /BUILD_ID: \$\{\{ needs\.publish\.outputs\.build_id \}\}/)
    assert.doesNotMatch(job('deploy'), /BUILD_ID" == "\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT"/)
  })

  test('all workflow and composite-action shell blocks parse without executing them', () => {
    const action = readFileSync(join(root, '.github/actions/deployment-diagnostic/action.yml'), 'utf8')
    for (const source of [workflow, action]) {
      const lines = source.split('\n')
      for (let index = 0; index < lines.length; index += 1) {
        const match = lines[index].match(/^(\s*)run: (.+)$/)
        if (!match) continue
        let script = match[2]
        if (script === '|') {
          const indent = match[1].length + 2
          const body = []
          while (index + 1 < lines.length) {
            const line = lines[index + 1]
            if (line.trim() && line.search(/\S/) < indent) break
            body.push(line.slice(indent))
            index += 1
          }
          script = body.join('\n')
        }
        const result = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' })
        assert.equal(result.status, 0, `${result.stderr}\n${script}`)
      }
    }
  })
})

describe('production shell failure paths without live services', () => {
  test('stale default SHA fails after the lock and cannot arm mutation', () => {
    for (const title of [
      'Reject a stale default-branch candidate after acquiring the deployment lock',
      'Arm rollback before production mutation',
    ]) {
      const result = execute('deploy', title, { FAKE_HEAD: 'f'.repeat(40) })
      assert.notEqual(result.status, 0)
      assert.match(result.stdout, /::error::A newer default-branch commit/)
      assert.doesNotMatch(result.exportedEnv, /DEPLOYMENT_MUTATED=true/)
      assert.doesNotMatch(result.trace, /az |docker /)
    }
  })

  test('a successful HEAD lookup that exhausts the safety reserve cannot arm mutation', () => {
    const result = execute('deploy', 'Arm rollback before production mutation', {
      EXPIRE_DURING_LOOKUP: 'true',
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stdout, /::error::Preflight exhausted the reserved candidate and rollback time/)
    assert.doesNotMatch(result.exportedEnv, /DEPLOYMENT_MUTATED=true/)
    assert.doesNotMatch(result.trace, /az |docker /)
  })

  test('publication rejects a loaded image different from the smoke-tested image', () => {
    const title = 'Validate immutable publication inputs'
    assert.equal(execute('publish', title).status, 0)
    const wrong = execute('publish', title, { FAKE_IMAGE_ID: `sha256:${'f'.repeat(64)}` })
    assert.notEqual(wrong.status, 0)
    assert.match(wrong.stdout, /::error::Transferred image differs/)
    assert.doesNotMatch(wrong.trace, /docker (?:push|tag)|az /)
  })

  test('reruns preserve the producing build identity and never overwrite an existing candidate', () => {
    const validation = execute('publish', 'Validate immutable publication inputs', { BUILD_ID: '12345-1' })
    assert.equal(validation.status, 0, validation.stderr)
    const deployment = execute('deploy', 'Validate immutable deployment inputs', { BUILD_ID: '12345-1' })
    assert.equal(deployment.status, 0, deployment.stderr)
    const publication = execute('publish', 'Push the smoke-tested image and resolve its exact digest', {
      BUILD_ID: '12345-1', FAKE_CANDIDATE_COUNT: '1',
    })
    assert.equal(publication.status, 0, publication.stderr)
    assert.match(publication.trace, /docker pull /)
    assert.doesNotMatch(publication.trace, /docker tag|docker push/)
    const mismatch = execute('publish', 'Push the smoke-tested image and resolve its exact digest', {
      FAKE_CANDIDATE_COUNT: '1', FAKE_IMAGE_ID: `sha256:${'f'.repeat(64)}`,
    })
    assert.notEqual(mismatch.status, 0)
    assert.match(mismatch.stdout, /::error::Published image differs/)
    assert.doesNotMatch(mismatch.trace, /docker tag|docker push/)
  })

  test('publication pushes the transferred image without a build or production mutation', () => {
    const result = execute('publish', 'Push the smoke-tested image and resolve its exact digest')
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.trace, new RegExp(`docker tag shapepilot-ci:${SHA}-12345-2 ${REPOSITORY}:${SHA}-12345-2`))
    assert.match(result.trace, /docker push /)
    assert.doesNotMatch(result.trace, /build|webapp|:latest/)
  })

  test('activation proves writer absence before replacement and health before promotion', () => {
    const result = execute('deploy', CANDIDATE)
    assert.equal(result.status, 0, result.stderr)
    const beforeReplacement = result.trace.split('az webapp config container set')[0]
    assert.equal((beforeReplacement.match(/curl /g) ?? []).length, 3)
    assert.ok(result.trace.indexOf('node scripts/verify-deployment.mjs') < result.trace.indexOf('docker tag'))
    assert.equal((result.trace.match(/node scripts\/verify-deployment\.mjs/g) ?? []).length, 2)
    assert.equal(result.configured, `${REPOSITORY}@${DIGEST}`)
    assert.equal(result.latest, DIGEST)
  })

  test('a responding old writer or unconfirmed ARM stop forbids image replacement', () => {
    for (const override of [{ WRITER_HTTP_STATUS: '200' }, { STOP_STATE: 'Running' }]) {
      const result = execute('deploy', CANDIDATE, override)
      assert.notEqual(result.status, 0)
      assert.match(result.stdout, /::error::Old SQLite process did not become observably absent/)
      assert.doesNotMatch(result.trace, /config container set|webapp start|docker tag|docker push/)
      assert.equal(result.configured, `${REPOSITORY}@${PREVIOUS_DIGEST}`)
    }
  })

  test('failed health or protected configuration cannot promote latest', () => {
    for (const override of [{ FAIL_HEALTH: 'true' }, { FAKE_FINGERPRINT: 'changed' }]) {
      const result = execute('deploy', CANDIDATE, override)
      assert.notEqual(result.status, 0)
      assert.doesNotMatch(result.trace, /docker tag|docker push/)
      assert.equal(result.latest, PREVIOUS_DIGEST)
    }
  })

  test('failure and cancellation restore only the preloaded exact prior image under the same bound', () => {
    for (const cancelled of ['false', 'true']) {
      const result = execute('deploy', ROLLBACK, { ROLLBACK_CANCELLED: cancelled })
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.trace, /timeout --signal=TERM --kill-after=5s 235s bash/)
      assert.ok(result.trace.indexOf('webapp stop') < result.trace.indexOf('config container set'))
      assert.match(result.trace, /--expected-sha b{40} --expected-build-id 12344-1/)
      assert.match(result.trace, /--confirmations 3/)
      assert.match(result.trace, /webapp config appsettings list/)
      assert.doesNotMatch(result.trace, /docker pull|deploy:monitor|deploy:acr/)
      assert.equal(result.configured, `${REPOSITORY}@${PREVIOUS_DIGEST}`)
      assert.equal(result.latest, PREVIOUS_DIGEST)
    }
  })

  test('first-release cleanup stops the writer and removes only the failed latest alias', () => {
    const result = execute('deploy', INITIAL_ROLLBACK, { INITIAL_DEPLOYMENT: 'true' })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.trace, /acr repository untag --name acrenzolopez01 --image shapepilot:latest/)
    assert.doesNotMatch(result.trace, /webapp start|repository delete|docker (?:rm|volume)/)
    assert.equal(result.configured, `${REPOSITORY}@sha256:${'c'.repeat(64)}`)
    assert.equal(result.latest, '')
  })
})
