# ShapePilot

Approachable AI-assisted 2D/3D design, viewing, editing, and fabrication.

Four designers, one shared document, so a design can move between them.
Geometry, validation and fabrication exports are produced in the browser.
The server stores app data and the optional Admin printer-history ledger.

| | |
| --- | --- |
| **Keycap Projects** | One keycap set per project: its cap inventory, photos of it read by the assistant, and the trays cut for it. |
| **Keycap Tray Designer** | Lay out keycap pockets in a tray profile. STL, 3MF, SVG, DXF. |
| **Shaper Designer** | 2D design for the Shaper Origin: shapes, text, the five Origin cut types. Imports SVG, DXF, STL. |
| **Bambu Designer** | Tinkercad-style 3D modelling for the Bambu Lab X2D: solids and holes resolved by grouping, align, mirror. Imports STL, OBJ, 3MF, SVG. |
| **AI Imagination Playground** | Describe a part, refine it in conversation, then hand it to either designer. |
| **EL-ement Statistics (Admin only)** | Read-only Bambu printer/AMS monitoring, durable cloud job history, filtered charts, CSV and printable reports for the household printer. |

The two 3D designers evaluate booleans with [manifold-3d](https://github.com/elalish/manifold),
which guarantees watertight output — a requirement for anything that will be
sliced. The assistant runs on a Foundry resource dedicated to this app so its
inference cost is attributable on its own; see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

The Keycap Tray Designer's behaviour and data come from Hearth commit
`f0b05fc1dbf53e8aa26c215d8e858894a2793871` (version 2.13.2, build 172). See
[`docs/SOURCE_LINEAGE.md`](docs/SOURCE_LINEAGE.md).

## Requirements

- Node 24 or newer — the server runs TypeScript directly through Node's type
  stripping, so there is no build step for it.
- A C toolchain for `better-sqlite3` and ShapePilot's SQLite file-identity guard
  (usually already present).

## Local setup

```bash
npm install

# Terminal 1 — API on :8080, with the documented development auth bypass.
NODE_ENV=development \
SHAPEPILOT_DEV_AUTH=1 \
SHAPEPILOT_ENTRA_TENANT_ID=<tenant-guid> \
SHAPEPILOT_API_AUDIENCE=api://shapepilot-dev \
npm run dev:server

# Terminal 2 — SPA on :5173, proxying /api to :8080.
VITE_AUTH_MODE=development npm run dev
```

Open <http://localhost:5173>. The development bypass signs you in as a local
admin so you can use the app without an Entra tenant. It is refused outright
when `NODE_ENV=production`.

To run against real Entra, drop `SHAPEPILOT_DEV_AUTH` and `VITE_AUTH_MODE` and
set the `VITE_*` values in `.env.example`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server for the SPA |
| `npm run dev:server` | API with file watching |
| `npm start` | API with `NODE_ENV=production` enforced by the production launcher |
| `npm run build:native` | Build the pinned SQLite descriptor-identity guard |
| `npm run build` | Native guard plus production SPA build into `dist/client` |
| `npm run check:architecture` | Enforce Node/container/SQLite/workflow boundaries |
| `npm run typecheck` | `tsc -b --noEmit` across both projects |
| `npm run lint` | ESLint |
| `npm test` | The complete Vitest suite |
| `npm run db:init` | Create and migrate the app-owned SQLite authority explicitly |
| `npm run legacy:export` | Export from an approved immutable Hearth backup |
| `npm run legacy:import` | Read-only dry run, then hash-gated apply |
| `npm run legacy:reconcile` | Independent source/target proof |
| `npm run recovery` | `backup` / `list` / `verify` / `restore` |
| `npm run deploy:migration-check` | Prove the prior release remains compatible with the candidate schema |

## Environment

Use `.env.example` for variable names. Entra has no client secret and Foundry
uses managed identity in production. The optional Bambu access token is a
secret: supply it only through server environment/secret-store configuration,
never a `VITE_` variable or a committed environment file.

| Variable | Required | Meaning |
|---|---|---|
| `NODE_ENV` | yes outside `npm start` | `development`, `test` or `production`; never inferred |
| `PORT` | production | API port, default `8080` outside production; production requires `3000` |
| `AAD_TENANT_ID` / `SHAPEPILOT_ENTRA_TENANT_ID` | yes | Tenant whose tokens are accepted; aliases must agree |
| `SHAPEPILOT_API_AUDIENCE` | yes | ShapePilot API identifier URI (`api://<client-id>`); the server derives the Entra v2 token's client-ID `aud` claim |
| `SHAPEPILOT_API_SCOPE` | no | Required delegated scope, default `access_as_user` |
| `SHAPEPILOT_JWKS_URI` | no | Override the tenant's JWKS endpoint |
| `SHAPEPILOT_ADMIN_OIDS` | no | Comma-separated GUIDs granted `admin` on first sign-in |
| `DB_PATH` / `SHAPEPILOT_DB_PATH` | production / no | Production requires an absolute canonical path; development defaults to `data/shapepilot.db` |
| `SQLITE_JOURNAL_MODE` | production | Must be exactly `DELETE` |
| `SHAPEPILOT_DB_BUSY_TIMEOUT_MS` | no | 100–60000, default 5000 |
| `SHAPEPILOT_DB_ALLOW_CREATE` | no | Development-only create mode; production rejects it |
| `SHAPEPILOT_INITIALIZE_EMPTY_DB` | first allocation only | Exact value `1` enables one-time hash-pinned schema-only initialization; remove after readiness |
| `BACKUP_ROOT` / `SHAPEPILOT_ARTIFACT_STORE_DIR` | production / recovery | External destination for backup bundles |
| `RECOVERY_WORK_ROOT` / `SHAPEPILOT_RECOVERY_WORK_DIR` | no | Bounded recovery scratch path; production image pins `/home/data/recovery/shapepilot` |
| `SHAPEPILOT_CLIENT_DIR` | no | Built SPA directory, default `dist/client` |
| `SHAPEPILOT_DEV_AUTH` | no | Development bypass. **Refused when `NODE_ENV=production`** |
| `SHAPEPILOT_DEV_AUTH_OID` / `_TENANT_ID` / `_NAME` / `_EMAIL` / `_ROLE` | no | Identity the bypass presents |
| `VITE_AUTH_MODE` | no | `development` skips the sign-in gate in the SPA |
| `VITE_AZURE_CLIENT_ID` / `VITE_AZURE_TENANT_ID` / `VITE_API_SCOPE` | for production Entra | Canonical build-time MSAL configuration |
| `VITE_ENTRA_CLIENT_ID` / `VITE_ENTRA_TENANT_ID` | no | Development compatibility aliases |
| `SHAPEPILOT_BAMBU_ACCESS_TOKEN` | optional, server only | Account owner's Bambu Cloud bearer token, supplied by the secret store; never stored in SQLite or returned to the browser |
| `SHAPEPILOT_BAMBU_REGION` | no | `global` (default) or `china`, matching the Bambu account |

## EL-ement Statistics setup

Open **Admin -> EL-ement Statistics** (`/admin/el-ement-statistics`). This is a
single household-printer connection shared only with ShapePilot administrators,
not per-user Bambu onboarding. Every configuration, status, history and export
API re-reads the caller's app-local admin role.

1. The account owner obtains an access token through Bambu's regional cloud
   login flow using a trusted credential-handling client. The community API
   documents `POST /v1/user-service/user/login` and may require an email
   verification code or additional account verification. ShapePilot does not
   collect a Bambu password, bypass verification or access an OS keychain.
   Transfer only the resulting `accessToken` directly into the server secret
   store. Do not put login responses in a terminal transcript, shared logs or
   source control.
2. Supply `SHAPEPILOT_BAMBU_ACCESS_TOKEN` and, if needed,
   `SHAPEPILOT_BAMBU_REGION`. A resolved secret-store reference is supported;
   an unresolved Key Vault reference is shown as unavailable. Restart the
   ShapePilot server after changing configuration. No token value is returned
   by the Admin API or persisted to SQLite/backups.
3. In **Household printer connection**, select **Verify connection**, choose
   a bound printer, then **Enable monitoring**. Missing credentials, expired
   or rejected credentials, an unbound printer and an account/region mismatch
   have distinct recovery messages. Disabling monitoring stops automatic network
   work without deleting history; verification remains an explicit admin action.

Allow outbound connections to the selected region's fixed hosts:

| Region | HTTPS API (TCP 443) | MQTT over TLS (TCP 8883) |
| --- | --- | --- |
| `global` | `api.bambulab.com` | `us.mqtt.bambulab.com` |
| `china` | `api.bambulab.cn` | `cn.mqtt.bambulab.com` |

Deploy through the existing guarded, one-worker SQLite startup path.
Migration `012-element-statistics` adds the ledger tables; retain the required
pre-migration snapshot and use the existing recovery procedure for rollback,
rather than editing SQL or migration checksums manually.

For rotation, replace the server-held token, restart ShapePilot and verify
again. Do not rely on Bambu's currently unusable refresh-token endpoint. A
different verified account/region/printer is a separate history partition;
old records remain filterable. The connector makes allowlisted HTTPS requests
and TLS MQTT **subscriptions only**. It does not send printer-control commands,
request a camera/video stream, or use any retired app or relay.

History backfills in bounded, checkpointed pages and refreshes every five
minutes independently of browser lifetime. Recent, active and unknown-result
jobs are rechecked; available history is rescanned daily. A manual rescan
preserves the ledger. Live samples are coalesced to one per minute and kept for 30 days.
Imported jobs and recorded state/error events are retained; a crash may lose
the latest unflushed sampling interval. State-change bursts above 100 events
per interval are coalesced and recorded as a gap.

Reports share the same persisted filter scope across charts, job pages, CSV
and printable output. Calendar dates are inclusive in the chosen IANA time
zone. Shared links keep explicit date bounds; a saved relative preset is shown
as a custom range once those dates are no longer relative. Material filters
select whole jobs containing that material, so a multi-material job's totals
include all of its materials. Runtime is attributed to its start-date bucket,
not reported as day-by-day machine occupancy. Date/printer scopes exceeding
50,000 jobs return an explicit limit error; use narrower date ranges to report
longer ledgers in parts. No historical rows are deleted by this limit.

**Measurement limits:** `costTime`, `weight` and `length` are full sliced-job
estimates, including failed/aborted jobs. Status `3` does not reliably
distinguish failure from cancellation. Status `1` remains unknown rather than
being assumed active; unknown results remain eligible for refresh. Actual elapsed
duration requires valid terminal start/end timestamps; active, placeholder and ambiguous timestamps
remain unavailable. Unqualified length units remain unreported. Material
mapping estimates may differ from whole-job estimates; they are not scaled
to invent agreement. Fields omitted from a later cloud response retain their
last reported values; explicit null or invalid values clear them. Elapsed
runtime is recomputed from the merged terminal timestamps, never carried
forward across invalidated dates or non-terminal results. A job's last-seen
time is not a timestamp for each individual estimate. Nothing estimates actual
extrusion, waste, financial costs or decrements Filaments ownership ticks.

Cloud retention, completeness and local/SD-card coverage are **not guaranteed**.
Coverage shows recorded bounds, undated jobs, partial scans, errors and the
last successful sync; this is not a lifetime odometer. The integration uses
community-observed [Bambu cloud HTTP](https://github.com/Doridian/OpenBambuAPI/blob/main/cloud-http.md)
and [MQTT](https://github.com/Doridian/OpenBambuAPI/blob/main/mqtt.md) contracts,
not a stable public API. Injected transport tests prove the implementation,
**not authenticated connectivity**: the operator must verify the chosen
account and printer after safe configuration before relying on live recording.

## Architecture in one screen

- **Frontend.** React 19 + Vite 7 + MUI 7, strict TypeScript. Real URL routing
  with lazy feature boundaries — no global view switch. Global providers are
  limited to auth, theme, confirmation and audit. Every API call goes through a
  typed feature service.
- **Backend.** Express 5 on Node 24. `server/app.ts` builds the app and never
  listens; `server/bootstrap.ts` owns the socket and the lifecycle.
- **Data.** One `better-sqlite3` connection, `journal_mode=DELETE`,
  `foreign_keys=ON`, bounded `busy_timeout`, append-only checksummed migrations.
  A pinned native guard binds writable opens to the preflighted file descriptor
  before recovery or SQL. Route and feature code uses async repository contracts
  and never sees the handle.
- **Identity.** MSAL access token for ShapePilot's own API audience; the server
  verifies signature, issuer, audience, lifetime, tenant, GUID `oid` and scope.
  `(tenant_id, oid)` is the only authorization key. Roles are app-local and
  re-read from the database on every admin call.
- **Health.** `/api/live` never touches the database. `/api/ready` runs one
  bounded probe plus schema, DELETE-journal, and foreign-key checks. Both expose
  the exact SHA, run-attempt build ID, and stable process instance ID with
  `Cache-Control: no-store`. `/api/version` and `/version.json` serve the same
  immutable build and source lineage.
- **Geometry.** Layered 2D polygon extrusion with three watertightness repair
  passes. No 3D CSG, no server-side geometry.

Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Scope

What ShapePilot is for, and what is deliberately not built yet, is in
[`PRODUCT.md`](PRODUCT.md).

| Document | Contents |
|---|---|
| [`PRODUCT.md`](PRODUCT.md) | Purpose, users, durable constraints, deferred scope |
| [`docs/SOURCE_LINEAGE.md`](docs/SOURCE_LINEAGE.md) | Pinned commit, copied file map, deliberate differences |
| [`docs/PARITY_CHECKLIST.md`](docs/PARITY_CHECKLIST.md) | Every inherited behaviour and its evidence |
| [`docs/DATA_MIGRATION.md`](docs/DATA_MIGRATION.md) | Immutable-source import, dispositions, cutover |
| [`docs/RECOVERY.md`](docs/RECOVERY.md) | Backup, verify, restore, and the prohibitions |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Boundaries and extension points |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Container, CI, release, rollback, and production data contract |

Azure resources remain owned by `EnzoLopez2023/azure-infra`; this repository
builds and deploys only the ShapePilot image. No tool here can provision Azure
or write to a Hearth database.
