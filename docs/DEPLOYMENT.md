# Production deployment

ShapePilot follows the `p1-11-v1` `sqlite-one-worker` contract from
`EnzoLopez2023/azure-infra`. The CI pipeline in this repository never provisions
or reconciles Azure resources; it only validates the declared resources and
deploys an immutable ShapePilot image.

Provisioning by hand is permitted only with the owner's explicit, per-resource
permission, and anything created that way must be recorded here and reconciled
back into `azure-infra`. One resource currently sits in that state:

| Resource | Created | Why it is separate |
| --- | --- | --- |
| `aif-shapepilot-prod` (Microsoft.CognitiveServices, kind `AIServices`, S0, eastus, tagged `app=shapepilot`) | 2026-08-30, by hand with permission | A Foundry account used only by ShapePilot, so its inference spend is attributable to this app on its own billing line rather than pooled with other apps. |

It carries one model deployment, `shapepilot-designer`
(`gpt-5.6-terra` 2026-07-09, GlobalStandard, 50K TPM). GlobalStandard is
pay-per-token with no idle cost, so an unused deployment bills nothing.

## Runtime image

`Dockerfile` is a reproducible multi-stage Linux build pinned to Node 24.17.0 by
manifest digest. Both dependency stages run `npm ci` with lifecycle scripts and
a C/Python toolchain, so `better-sqlite3` and the pinned native filesystem
guards are built for the runtime ABI. The final image contains production
dependencies only, runs as the non-root `node` user, declares no `/home` volume,
and exposes port 3000.

The build requires a full Git SHA, a `<run-id>-<run-attempt>` build ID, a
canonical UTC commit timestamp, and complete Entra SPA settings. Those values
are stamped into `version.json` before the client build and copied into OCI
labels. Runtime environment variables cannot override that identity.

## Persistent data

Production is exactly one App Service worker, one Node process, one
`better-sqlite3` connection, and one authority at
`/home/data/shapepilot.db`. The process requires `journal_mode=DELETE`,
foreign keys, and a bounded busy timeout. It never enables WAL and never uses
PostgreSQL or an ORM.

The production authority must exist before normal startup. A missing file is
treated as a missing or incorrect volume, not as an empty installation. The
only exception is the temporary, exact
`SHAPEPILOT_INITIALIZE_EMPTY_DB=1` first-allocation flag described below; it
creates a schema-only authority and never imports Hearth data.
Backups go to `/home/data/backups/shapepilot`; bounded recovery scratch goes to
`/home/data/recovery/shapepilot`. Backup, integrity, and restore work remains
operator-invoked and never runs during startup or a request.

The mounted database parent, backup root, and recovery work root must be
readable, writable, and searchable by the image's non-root `node` user
(UID/GID 1000). Startup validates those permissions before opening SQLite.
Database and seed-marker files must be UID/GID 1000:1000 mode `0600` except on
the App Service persistent `/home` mount, where Azure Files exposes regular
files as the fixed UID/GID 65534:65534 mode `0777` representation. That exact
alternative is accepted only when the App Service instance and persistent
storage environment are both present; all other metadata still fails closed.

## CI

The single `.github/workflows/ci.yml` workflow runs on pinned Ubuntu 24.04 and
Node 24.17.0. It installs with lifecycle scripts, then gates architecture
invariants, strict TypeScript, ESLint, all Vitest suites, the native guard and
client build. The full and production dependency audits retain their
`audit-level=high` threshold, and the CycloneDX source SBOM still runs, but
their results are deployment diagnostics rather than release gates.

The container job builds the pinned image, verifies its non-root user, labels,
and `/home` volume prohibition, initializes a disposable production-shaped
SQLite volume, then uses `docker exec` to prove three consecutive agreeing
static-version/version/liveness/readiness rounds and the native
`better-sqlite3` DELETE-journal authority.

### Observable deployment diagnostics

ShapePilot vendors `deployment-diagnostics-v1` from
`EnzoLopez2023/azure-infra` PR 24 at reviewed commit
`f45790e9df7c9fabbc53dd04e6055a59d6f28f39`. The exact source paths and Git
blob IDs are retained in `deployment-diagnostics/provenance.json`.

Applicable pre-deployment checks still run at their existing strength. A
finding, checker failure, or absent run-specific prerequisite produces a
warning, a job-summary row, and a structured JSONL record without stopping the
candidate build or activation. Quality and deployment diagnostic artifacts are
uploaded best-effort with 30-day retention; an upload failure emits a warning.
Checkout, tool setup, OIDC authentication, image build and push, digest
resolution, activation, post-activation verification, and rollback remain
blocking.

## Production job

On pushes to `main`, the deployment job in `.github/workflows/ci.yml` waits for
both CI jobs and then uses Azure federated OIDC only. Pull requests run CI
without receiving OIDC permission. Deployment requires the nonsecret
`AZURE_CLIENT_ID` and `VITE_AZURE_CLIENT_ID` Actions variables and fails before
Azure mutation unless the latter is exactly
`60b0b8cf-f1e2-4ba4-b89b-7d6dc3358251`. The workflow
targets only:

- resource group `rg-personal-apps-prod`;
- shared ACR `acrenzolopez01` (`acrenzolopez01.azurecr.io`);
- repository `shapepilot`;
- Web App `app-shapepilot-prod-lwxhu7jxlrbtu`.

The ACR is an existing shared Basic registry. ShapePilot never provisions it,
changes its properties or permission mode, or writes outside the collision-free
`shapepilot` repository. Deployment preflight requires the exact subscription
and resource group, admin disabled, public access enabled, and
`LegacyRegistryPermissions`.

The deployment principal is `github-shapepilot-ci`. Its federated subject must
be exactly
`repo:EnzoLopez2023/ShapePilot:ref:refs/heads/main`. It has Website Contributor
(`de139f84-1756-47ae-9be6-808fbbe84772`) scoped only to that Web App; Reader
(`acdd72a7-3385-48ef-bd42-f606fba81ae7`) scoped to the production resource group
for resource preflight and zero-alert enumeration; plus AcrPush
(`8311e382-0749-4cb8-b61a-304f252e45ec`) and AcrDelete
(`c2f4ef07-c644-48eb-af81-4b1b4947fb11`) scoped only to the shared ACR. It has
no Contributor, Monitoring Reader, Tasks Contributor, Data Importer, or
subscription role. AcrDelete is retained only to remove a failed first
release's `:latest` alias.

Every workflow run enumerates the OIDC service principal's direct and inherited
assignments from the exact resource-group and ACR scopes, plus the exact Web App
scope for deployment, and rejects any observed assignment outside this set.
Image-only publication requires the resource-group Reader and exact-ACR
AcrPush/AcrDelete assignments without requiring the Web App to exist;
deployment requires all four.

The exact ACR scope is
`/subscriptions/1cf02211-8d77-4658-bb6a-0f83ec831c3b/resourceGroups/rg-personal-apps-prod/providers/Microsoft.ContainerRegistry/registries/acrenzolopez01`;
the Web App scope is the corresponding
`Microsoft.Web/sites/app-shapepilot-prod-lwxhu7jxlrbtu` resource in that
resource group.

The Web App's system identity has AcrPull
(`7f951dda-4ed3-4680-a7ca-43fe172d538d`) at the exact shared ACR scope. Legacy
permissions make both deployment writes and runtime reads registry-wide rather
than repository-scoped; that cross-repository blast radius is an explicit
owner-accepted tradeoff of the shared-registry model. App Service container
configuration must use that identity (`acrUseManagedIdentityCreds=true`); the
workflow verifies both the identity and its direct AcrPull assignment.
The compute tenant is `de625678-c55b-4494-9558-14946cbb6133`; the subscription
is `1cf02211-8d77-4658-bb6a-0f83ec831c3b`. The user-facing Entra tenant is
`52188f12-db6b-46c6-88ff-08c802f0ed3b`, and the API identifier URI is
`api://60b0b8cf-f1e2-4ba4-b89b-7d6dc3358251` with delegated scope
`access_as_user`; the committed client build argument is the literal
`VITE_API_SCOPE=api://60b0b8cf-f1e2-4ba4-b89b-7d6dc3358251/access_as_user`.
The single-tenant `ShapePilot` app registration must request v2 access tokens,
expose that identifier URI and scope, and retain the production URL as an SPA
redirect URI. Entra v2 access tokens carry the bare API client ID in `aud`;
the server derives that claim value from the standard `api://<client-id>`
identifier URI.
No GitHub Environment or static Azure credential is part of this contract.

The App Service configuration must provide these exact nonsecret values:

| Setting | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` / `WEBSITES_PORT` | `3000` |
| `WEBSITES_ENABLE_APP_SERVICE_STORAGE` | `true` |
| `WEBSITES_CONTAINER_STOP_TIME_LIMIT` | `60` |
| `DOCKER_REGISTRY_SERVER_URL` | `https://acrenzolopez01.azurecr.io` |
| `DB_PATH` | `/home/data/shapepilot.db` |
| `SQLITE_JOURNAL_MODE` | `DELETE` |
| `SHAPEPILOT_DB_BUSY_TIMEOUT_MS` | `5000` |
| `SHAPEPILOT_DB_ALLOW_CREATE` | `0` |
| `BACKUP_ROOT` | `/home/data/backups/shapepilot` |
| `RECOVERY_WORK_ROOT` | `/home/data/recovery/shapepilot` |
| `BACKUP_RETENTION_COUNT` / `BACKUP_INTERVAL_HOURS` | `14` / `24` |
| `AAD_TENANT_ID` / `SHAPEPILOT_ENTRA_TENANT_ID` | `52188f12-db6b-46c6-88ff-08c802f0ed3b` |
| `SHAPEPILOT_API_AUDIENCE` | `api://60b0b8cf-f1e2-4ba4-b89b-7d6dc3358251` |
| `SHAPEPILOT_API_SCOPE` | `access_as_user` |
| `VITE_AZURE_CLIENT_ID` | `60b0b8cf-f1e2-4ba4-b89b-7d6dc3358251` |
| `OFFHOST_BACKUP_ENABLED` | `false` |

`SHAPEPILOT_INITIALIZE_EMPTY_DB` is not a steady-state setting and must be
absent before every normal or initial deployment workflow run.

The disabled off-host declaration remains explicit:
`OFFHOST_BACKUP_ACCOUNT=strecoverywkhiw2g4hwik4`,
`OFFHOST_BACKUP_CONTAINER=shapepilot`,
`OFFHOST_BACKUP_SCAN_INTERVAL_MINUTES=60`,
`OFFHOST_BACKUP_STALE_HOURS=26`,
`OFFHOST_BACKUP_HEALTH_LOOKBACK_HOURS=2`,
`OFFHOST_BACKUP_DAILY_HEALTH_MAX_SOURCE_AGE_HOURS=23`,
`OFFHOST_BACKUP_MONTHLY_STALE_DAYS=35`, and
`OFFHOST_BACKUP_CLOCK_SKEW_MINUTES=5`. These settings do not enable background
backup work in ShapePilot; recovery remains explicit and operator-invoked.

`KEY_VAULT_URI` must be
`https://kv-shapepilot-prod.vault.azure.net/`. The only declared secret setting
is `AZURE_OPENAI_API_KEY`, and its App Service value must remain the versionless
Key Vault reference to secret `AZURE-OPENAI-API-KEY`; the workflow never reads,
prints, or uploads the secret value.

That setting is **vestigial and deliberately left unresolvable.** The secret it
points at does not exist, so the reference reports `SecretNotFound` and App
Service passes the reference string through verbatim as the value. The runtime
must therefore never treat `AZURE_OPENAI_API_KEY` as a credential in
production, and `server/config.ts` does not: it refuses any value there,
resolved or not, so the assistant always authenticates with the managed
identity. The key path exists only for local development, and an unresolved
reference is rejected as a value everywhere.

Creating the secret would be the wrong fix. It would replace a keyless
managed-identity flow with a long-lived key that grants full access to the
Foundry account and has to be rotated by hand — the posture `.env.example`
explicitly disclaims and the one Microsoft's own Foundry guidance recommends
against for production. The setting is retained only because the deploy job
asserts the app-settings map exactly; removing it means editing that
assertion, the table above, and the Web App out of band.

### AI design assistant

Two further app settings, both **non-secret**, configure the assistant behind
the Bambu Designer and the AI Imagination Playground:

| Setting | Value |
| --- | --- |
| `AZURE_AI_FOUNDRY_ENDPOINT` | `https://aif-shapepilot-prod.openai.azure.com/openai/v1/` |
| `AZURE_AI_FOUNDRY_DEPLOYMENT` | `shapepilot-designer` |

They must be set together; either alone is a startup `CONFIG_CONFLICT`. With
neither set the AI routes report themselves unavailable and the rest of the app
runs normally, which is the intended behaviour for local development.

Authentication is keyless. The server acquires a token for
`https://ai.azure.com/.default` through `DefaultAzureCredential`, which resolves
to the Web App's system-assigned managed identity
(`02e09929-0ac6-4d01-a08d-46ffa63f99d1`). That identity holds **Cognitive
Services OpenAI User** scoped to the Foundry account and nothing wider.

The endpoint pins the *deployment* name, not the model, so the model behind
`shapepilot-designer` can be changed in Azure with no code change and no
redeploy.

No App Insights component, availability test, alert, or action group is part of
the deployment contract. Before building, the workflow proves the owner
invariant that metric, scheduled-query, and smart-detector alert counts remain
exactly `0/0/0`. Registry preflight validates the approved shared ACR without
enumerating or coupling deployment to sibling repositories. Before activation,
the workflow resolves ShapePilot's run-unique tag again and requires it to match
the locally inspected immutable digest. Promotion, health checks, and rollback
also verify only ShapePilot's digest, build identity, and runtime configuration.

The workflow builds the run-unique `<sha>-<run-id>-<run-attempt>` candidate
locally on pinned Ubuntu, pushes only
`acrenzolopez01.azurecr.io/shapepilot`, resolves and pulls the exact digest, and
generates an SPDX image SBOM. It never invokes ACR Tasks or image import.

For the first allocation, manual `publish_image_only=true` performs the source,
build, SBOM, exact-digest, and shared-ACR contract gates without reading or
changing a Web App. It does not
create or move `:latest`. Allocation then creates the disabled Web App pinned to
that exact digest, attaches its AcrPull system identity, and prepares persistent
storage.

With the Web App still carrying no traffic, allocation temporarily sets
`SHAPEPILOT_INITIALIZE_EMPTY_DB=1` and starts the same immutable image. The
non-root process exclusively creates `/home/data/shapepilot.db` at mode `0600`,
applies the checked-in migration ledger, proves every domain table has zero
rows, hashes the bounded database, and exclusively writes
`/home/data/.shapepilot-empty-seed.json` with that hash, authority identity,
schema identity, and immutable build identity. Database and marker must either
both be absent or both exist; either partial state fails closed. An existing
database is never overwritten, and a repeated initialization verifies the
same zero-row hash instead of recreating it. After three direct readiness
confirmations, allocation removes the temporary flag and stops the Web App.
The normal workflow then runs once with `initial_deployment=true`, requires that
stopped exact-digest baseline and absent `:latest`, and performs the first
traffic activation. Hearth import and legacy cutover are forbidden in this
sequence.

For activation, the workflow stops the Web App and requires both ARM `Stopped`
and three failed liveness probes before changing the digest. It pins the exact
candidate digest, starts the app, and requires three consecutive uncached
direct-default-host TLS requests to `/version.json`, `/api/version`, `/api/live`,
and `/api/ready` that agree on the full SHA and build ID; the dynamic endpoints
also agree on process instance while readiness proves the SQLite authority.
Only then does it locally tag the already-pulled digest as `:latest`, push that
tag, and prove the destination resolves to the identical digest; no rebuild is
allowed.

Failures and cancellations after the rollback guard is armed stop the failed
SQLite process, restore the previous App Service digest, restore the previous
`:latest` digest, and require three confirmations of the prior release. The
prior image is pulled before mutation. Failure rollback has a 20-minute bound
and rechecks protected app-setting/site fingerprints and the safety contract;
cancellation uses only the essential preloaded restore path with a four-minute
internal budget so it completes before GitHub's five-minute cancellation kill.
A failed first release instead stops the app, removes only the failed `:latest`
alias, and restores the prepublished immutable allocation digest.

The job records a mutation-start deadline at its first step and refuses to arm
rollback after 90 minutes. Its 180-minute outer bound therefore always leaves
at least 90 minutes for explicitly bounded activation, verification, promotion,
confirmation, and failure rollback steps.

Nonsecret SBOM, deployment, and rollback evidence is retained for 30 days. App
settings, tokens, Key Vault values, database content, and credentials are never
uploaded.

## Deploys that add a migration

Automatic rollback assumes the previous image can start against the database the
new one leaves behind. When a release adds a migration, it cannot: `migrate()`
refuses a database whose ledger is longer than the build ships
(`SCHEMA_AHEAD_OF_CODE`), `assertApprovedExistingSchema` refuses to open the file
at all, and readiness would report a schema-identity mismatch even if it did. So
the failure-rollback step runs, restores the previous digest, and that image will
not come up.

The exposure is exactly one deploy. Once the migration-carrying release is itself
the *previous* release, both sides know the migration and rollback works again.

This is a known, accepted limitation rather than an oversight. Closing it would
mean relaxing the exact-lineage database contract to tolerate a database that is
ahead by unknown migrations, which loosens the guard that catches a wrong file
mounted, a wrong backup restored, or a hand-edited schema. That trade has not
been taken.

### Before such a deploy

Take a snapshot from the App Service SSH console and keep the artifact id. The
Web App already sets `BACKUP_ROOT`, so no environment setup is needed:

```bash
node scripts/recovery.ts backup
```

### If verification fails

Automatic rollback will also fail. Recover deliberately:

```bash
# 1. Restore forward into a new file. Never over the live authority; in
#    production the destination must be a direct child of RECOVERY_WORK_ROOT.
node scripts/recovery.ts restore \
  --artifact <id> \
  --to /home/data/recovery/shapepilot/pre-<release>.db

# 2. Stop the Web App, then promote the restored file into DB_PATH by hand.
#    Restore never promotes; that step is deliberately an operator's.

# 3. Point the container back at the previous digest and start it.
az webapp config container set \
  --resource-group rg-personal-apps-prod \
  --name app-shapepilot-prod-lwxhu7jxlrbtu \
  --container-image-name <previous-digest-reference>
```

Writes made between the snapshot and the failure are lost. The window is the
verification period, so in practice that is nothing.

### Migrations shipped this way

| Migration | Release | Snapshot |
| --- | --- | --- |
| `003-design-documents`, `004-design-assets` | Shaper, Bambu and Playground designers | `/home/data/backups/shapepilot/pre-wave2-20260830T213939Z.db` |

That snapshot was taken with `sqlite3 .backup` from the Kudu console rather than
`scripts/recovery.ts backup`, because the app code lives in the application
container and Kudu is a separate one that shares only `/home`. It still goes
through SQLite's online backup API, so it cannot be torn by a concurrent
writer, and it was verified in place: `integrity_check` and `quick_check` both
`ok`, `foreign_key_check` empty, ledger at `001`/`002`.

It is a plain database copy, not a recovery artifact -- no manifest, no
identity derivation. That is enough for its one job, which is to restore the
pre-migration database if this deploy fails. Prefer `scripts/recovery.ts
backup` from the App Service SSH console when the app container is reachable.
