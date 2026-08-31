# Architecture

## Shape

```
src/        React 19 SPA — routing, auth, theme, feature modules
server/     Express 5 — construction, lifecycle, auth, routes, request
            validation, typed errors
lib/        db (connection, read-only inspection, identity, migrations,
            repositories), health, recovery, legacy tooling, build lineage
scripts/    operator commands: db init, legacy export/import/reconcile, recovery
test/       helpers, synthetic fixtures, parity and UI suites
```

Two TypeScript projects: `tsconfig.app.json` (DOM, JSX, `src` and the UI tests)
and `tsconfig.server.json` (Node, `server`/`lib`/`scripts` and the server-side
tests). Neither can accidentally reach the other's globals. Both are strict, with
`verbatimModuleSyntax` and `erasableSyntaxOnly`, so Node 24 runs the TypeScript
directly — no server bundler, no transpile step, no `tsx` in production.

`lib/contracts/` is the one directory both projects include. It holds pure,
dependency-free type-and-validator modules that must agree across the wire —
today `shapeProgram.ts`, the AI's geometry vocabulary, which the server
validates on the way out and the browser validates again on the way in.
Anything placed here must import nothing: no node, no DOM, no ApiError.

Shared client modules sit above the feature folders rather than inside one:

```
src/geometry/   2D primitives, boolean ops, triangulation, meshing, nesting
src/csg/        the shape program, its manifold-3d evaluator, scene <-> program
src/model/      the DesignDocument, its scene tree, machine profiles
src/state/      useDesignDocument, the undo/redo document hook
src/import/     STL, OBJ, 3MF, SVG, DXF readers and the browser asset store
src/export/     STL, 3MF, Shaper SVG, DXF writers
src/text/       glyph outlines, so text cuts as geometry rather than a font ref
```

## The client-side modelling boundary

Everything about geometry happens in the browser. The server has no geometry
code, no mesh code and no exporters, and it never will as long as this boundary
holds.

The pipeline is a stack of 2D polygon operations extruded straight up. There is
no 3D CSG anywhere and there should never be:

```
profile ─┬─ punch(through cuts)  → base       band 0 … F
         └─ punch(blind pockets) → top        band F … F+D
            difference(base, top) → pocket floors at z = F
```

Two rules generate every surface: a horizontal face at each layer interface, and
a side wall for each band. Outer rings are CCW and holes CW, so wall extrusion
needs no branch. Three separate mechanisms keep the result watertight, and all
three are load-bearing:

1. **T-junction insertion between regions** (`geometry/tjunction.ts`) — the
   clipper drops collinear split points when a union collapses back to a clean
   rectangle, so every region meeting at `z = F` is re-emitted with the others'
   vertices inserted.
2. **Collinear stitching** (`geometry/mesh.ts`) — earcut prunes collinear
   vertices before triangulating, so the cap's boundary can skip vertices the
   walls still use. Pruning is done here instead, which means the dropped
   vertices are known and can be stitched back as zero-area fans.
3. **Half-edge repair on the finished soup** (`geometry/mesh.ts`) — any edge used
   once and not matched in reverse is split through the mesh vertices that lie
   on it.

`QUANTUM = 1e-4` mm is the single tolerance: the weld key, the clipper input
grid and the T-junction epsilon. It is coarser than float32 epsilon at tray
scale, so quantized vertices survive the STL write as distinct values.

Do not "simplify" any of the three repair passes. Each exists because a specific
real layout produced a mesh that looked fine and leaked.

## Data flow

```
component → feature service → services/http.ts → /api → route → repository → SQLite
```

Nothing above `lib/db` sees a `better-sqlite3` handle. Routes and features use
async repository contracts (`lib/db/repositories/contracts.ts`), so the driver
being synchronous is an implementation detail rather than an assumption baked
into every caller.

`services/http.ts` is the only place the client speaks HTTP. It attaches the
access token, bounds every request with a timeout and an `AbortController`, and
converts the server's `{ error: { code, message, details? } }` envelope into a
typed `ApiRequestError`. Feature services never touch MSAL and never construct a
base URL: the API is same-origin, proxied by Vite in development and served by
Express in production.

## SQLite as the authority

One process, one worker, one instance, one connection, one file. Before an
existing file is opened writable, a separate `readonly` + `query_only` handle
must prove its ShapePilot markers, approved migration-ledger prefix, and exact
prefix schema. The preflight pins the file's device, inode, size, and change
timestamps; the pathname and schema identity are proved again immediately before
writable use. Independently initialized authorities also carry a random durable
authority ID; the writable-capable handle remains `query_only` until it proves
that exact ID itself. The native pre-SQL guard also refuses rollback-journal,
WAL, or shared-memory sidecars, including a sidecar introduced after pathname
preflight. Bootstrap and operator import use this same boundary. A foreign,
replaced, or journal-raced file therefore fails before recovery, any application
pragma, or migration. An absent path can be initialized only
after an exclusive create reserves the final filename; a truly empty existing
file still requires explicit create mode. Failed reservations are never removed
through a racy pathname ownership check. After that proof, every writable open applies
`journal_mode=DELETE` (WAL needs shared memory Azure Files cannot provide),
`foreign_keys=ON` (the pocket cascade is load-bearing), and a bounded
`busy_timeout` so a stuck writer fails instead of hanging a request.

`NODE_ENV` is never inferred by configuration. The production launcher used by
`npm start` sets it to `production`; direct development and test entry points
must state their environment explicitly. Missing mode is a startup failure, not
a path to development authentication or a newly created local authority.
Production additionally requires an absolute `DB_PATH`, an explicit
`SQLITE_JOURNAL_MODE=DELETE`, a persistent `BACKUP_ROOT`, and a valid immutable
build identity. Startup verifies the database parent and bounded recovery paths
are writable before SQLite opens, while still refusing to create a missing
production authority.
The only exception is the first-allocation
`SHAPEPILOT_INITIALIZE_EMPTY_DB=1` path: while running as UID/GID 1000 it
exclusively creates the final database, proves a current schema with zero rows
in every domain table, and writes a private durable marker binding its SHA-256,
authority ID, schema identity, and immutable build. Database and marker partial
states fail closed; an existing database is never replaced or recreated. The
flag is removed after the first direct readiness proof and is not a legacy-data
cutover path.

Migrations are append-only and identified by a checksum over their exact
statements. Each ledger row stores its ordinal, id, name and checksum, and the
schema marker is a checksum over that ordered ledger — so a database with the
same *head* migration but a renamed, reordered, missing or differently applied
earlier migration is a different lineage and is treated as one. `002-app-identity`
writes the app and schema-format markers into the database itself, so a snapshot,
a restored copy and a live authority can all be identified from their own bytes
(`lib/db/identity.ts`). A checksum mismatch, an out-of-order ledger or a database
ahead of the build is a hard startup failure — a database that was not produced
by this code must not be served.

Reading is separated from writing at the connection level. `openDatabase`
preflights, migrates and serves; `openReadOnlyDatabase` (`lib/db/readonly.ts`) opens an
existing file with `readonly`, `fileMustExist` and `query_only = ON`, creates
nothing, sets no persistent pragma and runs no migration. The legacy import dry
run and the reconciliation command use the read-only path; only `--apply`, the
server bootstrap and `npm run db:init` may create or change a database.

## Request validation

Every keycap tray write body is validated completely in
`server/validation/keycapTray.ts` before a repository call opens a transaction:
plain-object shape, the discriminated profile (`rect` / `preset` / `custom`,
including known preset ids and finite, bounded, non-degenerate custom rings),
sizing, dimensions, the bounded pocket list and every pocket field. Unknown keys,
unknown enum values, numeric strings, `NaN`, `Infinity` and out-of-range
magnitudes are stable typed 400s carrying the offending field. Valid pinned
defaults are unchanged. ShapePilot persists the validated `shape` discriminant
so ISO Enter geometry survives save/open and clone; `mirror_x` remains a
legacy-import-only field. See `docs/PARITY_CHECKLIST.md`.

There is no integrity scan, backup, repair or unbounded work on the startup or
request path. That is a deliberate departure from the pinned Hearth behaviour;
see `docs/SOURCE_LINEAGE.md`.

## Identity and authorization

The SPA acquires an MSAL access token for ShapePilot's own API audience. The
server verifies signature (JWKS), issuer (v1 and v2 forms), audience, lifetime,
tenant, a GUID-shaped `oid`, and the required scope — or an equivalent app role
for a daemon caller.

`(tenant_id, oid)` is the persisted identity and the only authorization key.
Email and display name are stored bounded, for audit and display, and are never
consulted for access.

Roles are app-local: `user` and `admin`, in `app_memberships`. A token role claim
can only influence the row the *first* time an identity is seen; every admin call
re-reads the membership from the database, so a grant or revocation takes effect
immediately without a new token. There is no shared `hearth_users`, no shared
`hearth_permissions`, and no cross-app admin database.

A documented development bypass exists so local development and the test suite
can exercise the real routes without an Entra tenant. `loadConfig` throws if it
is requested with `NODE_ENV=production`, so a production process cannot reach
that code path at all. A presented bearer token is still fully verified even
when the bypass is enabled.

## Errors and audit

`ApiError` carries a status, a stable code and a safe message. The terminal
middleware collapses anything else into a generic 500, so SQL text, token
fragments, file paths and upstream URLs cannot leak. Every request carries an
`x-request-id`, echoed in the response and recorded in the audit trail.

Audit rows record the *verified* actor. A client may post an event for itself but
cannot claim to be anyone else, detail fields are bounded, and keys that look
like credentials are redacted before storage. Retrieval is admin-only.

## The artifact-store boundary

`lib/recovery/artifactStore.ts` is an object-store shaped interface. Backup
bundles and imported design assets live behind it — outside SQLite, outside the
repository, and outside the application's own disk. The filesystem adapter
ships now; a Blob adapter can be added without the database or any feature
module gaining an Azure dependency.

There are **two** stores, and the split is the point.

`lib/recovery/artifactStore.ts` holds backup bundles. Its guarantees follow
from what restore needs: a root pinned by file descriptor, exclusive
publication through `renameat2(RENAME_NOREPLACE)`, and a check at every step
that the file is still the file that was written. Those rest on a local POSIX
filesystem.

`lib/assets/assetStore.ts` holds imported geometry and reference photographs of
a keycap set. It writes by path — `mkdir -p`, an exclusive staging name,
`rename` into place — and decides idempotence by comparing the **stored
bytes**, not inode identity.

Assets went through the recovery store once, and could not be written at all on
App Service: production keeps `/home/data` on Azure Files, where inode numbers
are synthesized, mode is a fixed representation and the server rewrites
timestamps on close, so the identity invariants simply do not hold. They were
never needed here. Recovery-grade integrity is right for a bundle a restore
depends on and wrong for bytes that are allowed to vanish, and conflating the
two cost a feature rather than protecting one. `workshop.nintek.com` and Prism
store user files on the same mount the same ordinary way.

What assets keep is what earns its place: content-addressed, owner-scoped keys,
so a hash names bytes and never acts as a bearer token.

Imported assets are **deliberately not authoritative.** The recovery model has
exactly one authority: a restored backup is a single self-describing,
hash-verified SQLite file, and every stage re-derives its identity from the
bytes in front of it. Assets sit outside that. A missing one is an ordinary
state — the object reports as detached and can be re-attached — so a restored
database can never carry a broken reference. `design_assets` stores metadata
only, keyed by content hash and scoped by `(tenant_id, oid)`, because a hash
must never act as a bearer token. `keycap_project_photos` names a hash from that
table but is deliberately not a foreign key into it, for the same reason: the
route proves the hash is owned at write time, and a photo whose bytes have gone
missing leaves the project readable.

Making assets first-class would mean a manifest that bundles, hashes and
verifies them alongside the database, plus collection of unreferenced ones.
That trade has not been taken; the parametric document is the design.

## Extension points

- **New feature module.** Add `src/features/<name>/`, a lazy route in
  `app/routes.tsx`, a repository contract in `lib/db/repositories/`, and one
  append-only migration. Do not widen an existing table for an unrelated
  feature.
- **Persisted binary artifacts.** Implement `ArtifactStore` (backups) or
  `AssetStore` (assets) for Blob and store the object key plus its hash in
  SQLite. Never store bytes in the database. Pick by what the bytes are: if a
  restore depends on them, they belong behind the guard; if losing one degrades
  to "re-attach this file", they do not.
- **The AI design copilot.** Delivered. It emits a typed `ShapeProgram`
  (`lib/contracts/shapeProgram.ts`) that is validated server-side and again in
  the browser, previewed, and applied through a single `replace` call so an
  accepted turn is exactly one undo step. It does not mutate the document
  directly, and that rule holds for anything added to it.
- **A new geometry primitive.** Add the op to `lib/contracts/shapeProgram.ts`
  (including its required params), build it in `src/csg/evaluate.ts`, and map it
  both ways in `src/csg/fromScene.ts` and `toScene.ts`. `src/csg/evaluate.test.ts`
  asserts every primitive is watertight; a new one belongs in that list.
- **A new machine.** Add a profile to `src/model/machines.ts`. Checks read the
  profile rather than hard-coding a machine, so nothing else needs to change.
- **A second product surface.** Everything app-local — identity, settings, roles,
  audit, health, recovery — is already owned here. Nothing needs a shared
  service.
