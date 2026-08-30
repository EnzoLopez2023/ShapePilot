# Source lineage

Everything in this repository that was not written from scratch came from one
pinned commit of the Hearth monolith. This document records exactly which one,
exactly what was copied, and exactly what was deliberately left behind.

## Pinned source

| Field | Value |
|---|---|
| Repository | `EnzoLopez2023/Hearth` |
| Commit | `f0b05fc1dbf53e8aa26c215d8e858894a2793871` |
| Tree | `62cbd35861c511f7c17187c875d19ee6e353b80d` |
| App version | `2.13.2` |
| Build | `172` |
| Workflow run | `32935405922` |
| Image digest | `sha256:dc4df7e0f966be5b0608e71643d316cc5eba7590b8e56cec482583ab69443140` |

The same values are served immutably at `/api/version` and `/version.json` under
`sourceLineage`, so a running instance can always be tied back to its source.

They are also checked in, machine-readable, at `lib/legacy/approved-source.json`
(`shapepilot.approved-legacy-source.v1`), together with the approved backup
bundle identity, the source database byte length and SHA-256, the exact owned row
counts, the source schema identity and declared columns of all three tables, the
per-table `hearth.sqlite-table-canonical.v1` hashes and the ShapePilot product
hash. A legacy import that does not match that contract exactly cannot write —
see `docs/DATA_MIGRATION.md`.

Every read during the port used
`git -C <hearth> show f0b05fc1dbf53e8aa26c215d8e858894a2793871:<path>`.
The local Hearth working tree and its `HEAD`
(`9396372bd3825370c0b91a506f1de5261a709790`) were never read and never modified.

## Copied source map

Wave 2 promoted the modules with no keycap knowledge out of the feature folder
so the other designers could share them. Those rows say "promoted"; the code is
unchanged, only its address. `…` abbreviates `src/features/keycap-tray`.

| Hearth path | ShapePilot path | Change |
|---|---|---|
| `src/KeycapTray/geometry/vec.ts` | `src/geometry/vec.ts` | verbatim; promoted out of the feature (Wave 2) |
| `src/KeycapTray/geometry/shapes.ts` | `…/geometry/shapes.ts` | the generic ring builders moved to `src/geometry/primitives.ts` and are re-exported |
| `src/KeycapTray/geometry/triangulate.ts` | `src/geometry/triangulate.ts` | verbatim; promoted (Wave 2) |
| `src/KeycapTray/geometry/boolean.ts` | `src/geometry/boolean.ts` | verbatim; promoted (Wave 2) |
| `src/KeycapTray/geometry/tjunction.ts` | `src/geometry/tjunction.ts` | verbatim; promoted (Wave 2) |
| `src/KeycapTray/geometry/mesh.ts` | `src/geometry/mesh.ts` | verbatim; promoted (Wave 2) |
| `src/KeycapTray/geometry/layers.ts` | `…/geometry/layers.ts` | import paths only |
| `src/KeycapTray/geometry/validate.ts` | `…/geometry/validate.ts` | import paths; one unused parameter renamed `_d` |
| `src/KeycapTray/export/download.ts` | `src/export/download.ts` | verbatim; promoted (Wave 2) |
| `src/KeycapTray/export/stl.ts` | `src/export/stl.ts` | default header string; promoted (Wave 2) |
| `src/KeycapTray/export/threemf.ts` | `src/export/threemf.ts` | `Application` metadata string; promoted (Wave 2) |
| `src/KeycapTray/export/svg.ts` | `src/export/shaperSvg.ts` | takes cut layers instead of a `TrayDesign` (Wave 2); output byte-identical. `…/export/svg.ts` is now the tray's adapter |
| `src/KeycapTray/export/dxf.ts` | `src/export/dxf.ts` | takes cut layers instead of a `TrayDesign` (Wave 2); same entities, layers and extents, but grouped by layer rather than interleaved, which shifts entity handles. `…/export/dxf.ts` is now the tray's adapter |
| `src/KeycapTray/types.ts` | `…/model/types.ts` | `DEFAULT_FABRICATION` moved to `model/defaults.ts` |
| `src/KeycapTray/units.ts` | `src/units.ts` | verbatim; promoted (Wave 2) |
| `src/KeycapTray/presets.ts` | `…/model/presets.ts` | import paths only |
| `src/KeycapTray/profileData.ts` | `…/model/profileData.ts` | import path only |
| `src/KeycapTray/paletteItems.ts` | `…/model/defaults.ts` | app-owned local-storage key |
| `src/KeycapTray/useTrayDesign.ts` | `…/state/useTrayDesign.ts` | import paths only |
| `src/KeycapTray/api.ts` | `…/service.ts` | app HTTP client instead of `getApiBaseUrl()` |
| `src/KeycapTray/components/*.tsx` | `…/components/*.tsx` | Hearth glass/theme couplings removed; accessibility added |
| `src/KeycapTray/index.tsx` | `…/KeycapTrayPage.tsx` | sidebar props removed; workbench layout |
| `src/KeycapTray/geometry/*.test.ts`, `export/*.test.ts`, `units.test.ts` | same folders | `node:test` import swapped for `vitest`; assertions unchanged |
| `routes/keycap-trays.js` | `lib/db/repositories/keycapTrays.ts` + `server/routes/keycapTrays.ts` | typed, owner-scoped, typed error envelope |

`src/KeycapTray/components/glass.ts` was **not** copied. It is Hearth's frosted
chrome and has no place in an app-owned design system.

## Behavioural differences, and why

1. **Access token instead of ID token.** Pinned Hearth validated an
   app-audienced *ID* token because it had no API scope registered
   (`lib/adminAuth.js` says so in its own comment). The independent SQLite app
   baseline requires each app to expose its own API audience and validate an
   *access* token. ShapePilot follows the baseline.
2. **No startup `quick_check`.** Pinned Hearth runs an integrity check while
   opening the database. The baseline forbids integrity work on the startup and
   request paths. ShapePilot validates configuration, migrations and schema
   identity only; `quick_check`, `integrity_check` and `foreign_key_check` run
   exclusively inside the explicit recovery and import commands.
3. **No pre-migration `.bak` copy.** Hearth byte-copies the database once before
   its WAL→DELETE migration. ShapePilot is DELETE from its first migration and
   never byte-copies a live database.
4. **Owner scoping.** The three inherited tables gain
   `owner_tenant_id`/`owner_oid`; the library's global `UNIQUE(name)` becomes
   `UNIQUE(owner_tenant_id, owner_oid, name)`. The monolith had no per-user
   scoping to inherit.
5. **Branding strings in exports.** The STL header default and the 3MF
   `Application` metadata now say ShapePilot. No geometry-bearing byte changed:
   vertices, triangles, units, cut types, colours, layers and extents are
   identical.

## Excluded source

Not read, not copied, not referenced:

- Hearth local `HEAD` `9396372bd3825370c0b91a506f1de5261a709790`
- the Hearth PostgreSQL pull-request stack and integration branches
- `azure-infra` PostgreSQL rehearsal resources
- the global `AppView` registry, the app shell, the sidebar, the theme context,
  `src/utils/apiBaseUrl`, and every route module outside `routes/keycap-trays.js`
- shared tables: `hearth_users`, `hearth_permissions`, `audit_log`,
  `hearth_index`

## Extraction notes

- Ported tests keep their original `node:assert/strict` assertions verbatim.
  Only the test-runner import changed, so a failure means the same thing it
  meant in Hearth.
- The one test that read `systainer_tray_1_1u_caps.stl` from a developer's
  OneDrive folder was replaced by `test/parity/referenceGeometry.test.ts` and a
  checked-in fixture ShapePilot generates itself. See
  `test/fixtures/reference/README.md`.
- The deterministic 120-trial fuzz suite in `geometry/mesh.test.ts` is carried
  across unchanged, including its seed derivation, so any failure reproduces
  from the printed trial number exactly as before.
