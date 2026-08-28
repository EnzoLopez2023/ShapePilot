# ShapePilot

Approachable AI-assisted 2D/3D design, viewing, editing, and fabrication.

Wave 1 ships the **Keycap Tray Designer**: lay out keycap pockets in a tray
profile, see whether the result can actually be printed or cut, and export
STL, 3MF, SVG or DXF. Geometry, validation and every exported byte are produced
in the browser; the server stores design parameters and nothing else.

Behaviour and data come from Hearth commit
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
| `npm start` | API, production mode |
| `npm run build:native` | Build the pinned SQLite descriptor-identity guard |
| `npm run build` | Native guard plus production SPA build into `dist/client` |
| `npm run typecheck` | `tsc -b --noEmit` across both projects |
| `npm run lint` | ESLint |
| `npm test` | The complete Vitest suite |
| `npm run db:init` | Create and migrate the app-owned SQLite authority explicitly |
| `npm run legacy:export` | Export from an approved immutable Hearth backup |
| `npm run legacy:import` | Read-only dry run, then hash-gated apply |
| `npm run legacy:reconcile` | Independent source/target proof |
| `npm run recovery` | `backup` / `list` / `verify` / `restore` |

## Environment

Copy `.env.example` and fill it in. Nothing here is a secret; the app has no
client secret and uses managed identity in production.

| Variable | Required | Meaning |
|---|---|---|
| `NODE_ENV` | yes | `development`, `test` or `production` |
| `PORT` | no | API port, default `8080` |
| `SHAPEPILOT_ENTRA_TENANT_ID` | yes | Tenant whose tokens are accepted |
| `SHAPEPILOT_API_AUDIENCE` | yes | ShapePilot's own API audience |
| `SHAPEPILOT_API_SCOPE` | no | Required delegated scope, default `access_as_user` |
| `SHAPEPILOT_JWKS_URI` | no | Override the tenant's JWKS endpoint |
| `SHAPEPILOT_ADMIN_OIDS` | no | Comma-separated GUIDs granted `admin` on first sign-in |
| `SHAPEPILOT_DB_PATH` | no | Default `/home/data/shapepilot.db` in production, `data/shapepilot.db` otherwise |
| `SHAPEPILOT_DB_BUSY_TIMEOUT_MS` | no | 100–60000, default 5000 |
| `SHAPEPILOT_DB_ALLOW_CREATE` | no | Allow production to create a missing database. Off by default: an absent file means the volume did not mount |
| `SHAPEPILOT_ARTIFACT_STORE_DIR` | for recovery | External destination for backup bundles |
| `SHAPEPILOT_CLIENT_DIR` | no | Built SPA directory, default `dist/client` |
| `SHAPEPILOT_DEV_AUTH` | no | Development bypass. **Refused when `NODE_ENV=production`** |
| `SHAPEPILOT_DEV_AUTH_OID` / `_TENANT_ID` / `_NAME` / `_EMAIL` / `_ROLE` | no | Identity the bypass presents |
| `VITE_AUTH_MODE` | no | `development` skips the sign-in gate in the SPA |
| `VITE_ENTRA_CLIENT_ID` / `VITE_ENTRA_TENANT_ID` / `VITE_API_SCOPE` | for Entra | MSAL configuration |

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
  bounded probe plus a schema-identity check. `/api/version` and `/version.json`
  serve the identical immutable build and source lineage.
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

Not in this wave: Azure provisioning, deployment, the production cutover, and
anything that mutates Hearth or its data. No tool in this repository can write
to a Hearth database.
