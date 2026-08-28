# Parity checklist

Every legacy workflow, data semantic and export contract, with the evidence that
it survived the extraction. "Evidence" means an automated test unless stated
otherwise. Run `npm test` to execute all of it.

## Units and defaults

| Behaviour | Evidence |
|---|---|
| 25.4 mm/in conversion, nearest 1/32" formatting, fraction reduction | `model/units.test.ts` |
| Negative lengths format with a leading sign | `model/units.test.ts` |
| `1-3/8`, `3/8`, bare decimal-as-inches parsing | `model/units.test.ts` |
| Unparseable input returns `null` so the caller keeps the old value | `model/units.test.ts` + `test/ui/keycapTrayPage.test.tsx` |
| mm/inch round trip within half of 1/32" | `model/units.test.ts` |
| 19.05 mm pitch; `width = pitch·u + offset`; both sizing libraries | `geometry/geometry.test.ts` |
| Library sizing (−0.45, r 2.00) and Python sizing (−0.25, r 1.00) | `geometry/geometry.test.ts` |
| Preset dimensions: plain 248×156, notched 249×165.4826 | `geometry/mesh.test.ts`, `export/cnc.test.ts` |
| Default design: preset profile, floor 2.4, depth 10, engrave 0.4 | `test/parity/keycapTrayRoutes.test.ts` |
| `DEFAULT_FABRICATION`: 3.175 bit, 13 stock, 256×256 plate, 1.8 wall | `export/cnc.test.ts` |

## State and editing

| Behaviour | Evidence |
|---|---|
| 50-step undo/redo limit | `test/ui/keycapTrayPage.test.tsx` |
| Loading a design clears history and resets `revision` | same |
| `revision` advances once per mutation | same |
| A drag commits one history entry, not one per frame | same |
| Selection replace, additive toggle, clear on delete | same |
| Keyboard guard: Delete/Backspace and ⌘Z ignored inside inputs | `KeycapTrayPage.tsx` keydown handler; guard preserved verbatim |
| Snap values Off / 0.5 / 1 / 19.05 mm | `test/ui/keycapTrayPage.test.tsx` |
| Grid Off / 2 / 3 / 4 / 5 mm, capped at 400 lines per axis | `TrayCanvas.tsx` (cap preserved verbatim) |
| Alignment guides to pocket and tray centres, ~6 px tolerance | `TrayCanvas.tsx` (preserved verbatim) |
| Pan/zoom keeping the cursor point fixed; fit-to-view | `TrayCanvas.tsx` (preserved verbatim) |
| Pocket labels, build-plate and edge-buffer overlays | `test/ui/keycapTrayPage.test.tsx` |
| Palette filtering, common pins, All/Custom tabs | same |
| Custom library CRUD | same |
| 14 mm seed is idempotent and only when the library is empty | same |
| Profile, sizing and fabrication controls | `PropertiesPanel.tsx`; unit toggle covered by UI tests |
| 0°/90° rotation swaps extents | `geometry/geometry.test.ts`, `test/ui/keycapTrayPage.test.tsx` |
| New / Open / Save / Clone / Delete with busy, empty and error states | `test/ui/keycapTrayPage.test.tsx` |

## Geometry

| Behaviour | Evidence |
|---|---|
| Shoelace signed area; CCW outer, CW holes | `geometry/geometry.test.ts` |
| Rounded rect: CCW, exact extents, radius clamp, faceting convergence | same |
| Boolean union / difference / intersection | same |
| `unionDisjointFast` accepts a separated grid, rejects overlap | same |
| `punchDisjointFast` matches the general difference; falls back at the boundary | same |
| ISO Enter: two-row footprint, five rounded corners, sharp reflex notch | same |
| `pocketRing` dispatches `shape: 'iso-enter'` | same |
| Watertightness across 16 hand-written layouts | `geometry/mesh.test.ts` |
| Volume equals region area × band height | same |
| Pocket and through-cut material removal | same |
| Notched-profile containment regression | same |
| Full justified Shaper reference layout regression | same |
| Deterministic 120-trial fuzz across profiles and sizings | same |
| 75-pocket reference geometry fixture | `test/parity/referenceGeometry.test.ts` |

## Export

| Behaviour | Evidence |
|---|---|
| Binary STL is exactly `84 + 50n` bytes | `export/export.test.ts`, `test/parity/referenceGeometry.test.ts` |
| STL header never starts with `solid` | `export/export.test.ts` |
| STL round-trips every triangle vertex | same |
| STL normals point outward on the top and bottom faces | same |
| 3MF declares millimetres and matches the mesh vertex/triangle counts | same |
| 3MF carries `[Content_Types].xml` and `_rels/.rels` | same |
| 75-pocket tray bounding box 248 × 156 × 12.4 | same |
| SVG mm dimensions and 1:1 viewBox | `export/cnc.test.ts` |
| SVG shaper namespace, cut types, `cutDepth` | same |
| SVG colour convention `#FFFFFF`/`#7F7F7F`/`#000000`/`#0068FF` | same |
| SVG contains no live text | same |
| SVG y-flip places the model origin bottom-left | same |
| DXF `$ACADVER` AC1015, `$INSUNITS` 4, PROFILE/POCKETS/THROUGH layers | same |
| DXF entities are LWPOLYLINE only, one per profile ring and pocket | same |
| DXF `$EXTMAX` matches the tray footprint | same |
| Safe filename slug | `test/ui/keycapTrayPage.test.tsx` (`Untitled_tray.stl`) |
| Object URL revoked on a delay, not synchronously (Safari) | same |

## Manufacturability

| Behaviour | Evidence |
|---|---|
| 1.00 mm radius rejected for CNC, allowed for printing | `export/cnc.test.ts` |
| 2.00 mm library radius passes CNC | same |
| Pocket past the outline is an error, with the offending ids | same |
| Overlapping pockets warn | same |
| Depth beyond stock is a CNC-only error | same |
| Oversized tray is a print-only warning | same |
| A clean design produces no issues at all | same |
| Non-manifold mesh is a print error | `geometry/validate.ts` `checkMesh`; mesh suite proves it never fires |

## API and repository

| Behaviour | Evidence |
|---|---|
| `POST` returns 201 and a string id | `test/parity/keycapTrayRoutes.test.ts` |
| Full field round trip, nullables as `undefined` | same |
| `revision` always leaves the server as 0 | same |
| Pockets returned in `sort_order` | same |
| List ordered `updated_at DESC` with pocket counts | same |
| Update atomically replaces the whole pocket set | same |
| Clone copies design and pockets in one transaction; copy is independent | same |
| Clone accepts an explicit name, defaults to `… (copy)` | same |
| Delete cascades to pockets | same |
| Missing name → typed 400; missing `profile.kind` → typed 400 | same |
| Unknown id → typed 404 on GET/PUT/DELETE/clone | same |
| `/library/pockets` matched before `/:id` | same |
| Library list ordered by name; nullables as `undefined` | same |
| Duplicate library name → 409 with the pinned message | same |
| Same library name allowed for a different owner | same |
| Ownership isolation on read, list, update, delete | same |

## Auth, admin and audit

| Behaviour | Evidence |
|---|---|
| Signature, issuer (v1 and v2), audience, expiry | `test/parity/auth.test.ts` |
| Wrong tenant, missing tenant | same |
| Non-GUID `oid`; `sub` never substituted | same |
| Missing API scope → 403; app role accepted for daemons | same |
| Failure reason never leaked in the message | same |
| Unauthenticated feature route → 401 | same |
| Failed auth is audited without the token | same |
| Health and version are open | same |
| Admin role re-read from the database on every call | same |
| A token role claim cannot grant admin | same |
| Bootstrap admin applies on first sign-in only | same |
| An admin cannot demote themselves | same |
| Unmatched API path → typed 404, not the SPA shell | same |
| Destructive operation records a verified actor | `test/parity/keycapTrayRoutes.test.ts` |
| Client cannot spoof the audit actor; credential keys redacted | same |
| Development bypass refused when `NODE_ENV=production` | `test/parity/auth.test.ts` |
| Development bypass off unless explicitly enabled | same |
| A presented token is still verified even with the bypass on | same |

## Database, migrations, health

| Behaviour | Evidence |
|---|---|
| `journal_mode=DELETE`, `foreign_keys=ON`, bounded `busy_timeout` | `test/parity/database.test.ts` |
| Cascade fires; FK violation refused | same |
| Out-of-range busy timeout refused | same |
| Production refuses to create a missing database | same |
| Empty database migrates to head; re-migration is a no-op | same |
| Checksum mismatch, ledger divergence, schema-ahead all fail hard | same |
| Prior-schema database migrates forward without losing rows | same |
| Liveness never opens the database | same |
| Readiness is bounded and reports authority/schema/journal mode | same |
| Readiness not-ready on schema mismatch, non-ready lifecycle, probe failure | same |
| `/api/version` and `/version.json` are identical | same |

## Import and reconciliation

| Behaviour | Evidence |
|---|---|
| Deterministic, byte-identical repeat exports | `test/parity/legacyMigration.test.ts` |
| Raw JSON, timestamps, nulls, booleans, floats, `sort_order` preserved | same |
| Unicode and null edge cases | same |
| `sqlite_sequence` captured | same |
| Byte-length, hash, quiesced-source and evidence-completeness gates | same |
| Corrupt artifact refused | same |
| Dry run writes nothing and is deterministic | same |
| Bundle must match the checked-in approved source exactly: evidence, counts, schema identity, per-table canonical hashes and the product hash, all recomputed from the exported rows | `test/parity/approvedSource.test.ts` |
| ShapePilot's canonical hashes reproduce the independent coordinator oracle | same |
| Every approved field is load-bearing; a mismatch cannot write | same |
| Dry run creates no directory, file, database, pragma or migration, and leaves bytes, hash, mtime, sidecars, ledger and counts untouched | `test/parity/dryRunReadOnly.test.ts` |
| An absent target fails without touching the filesystem; a foreign app marker or diverged ledger is refused | same |
| A compatible non-empty target is inspected read-only: exact rows are noops, collisions are reported, idempotent replay still works | same |
| Owner must be explicit and GUID-shaped | same |
| Tampered bundle, wrong column list refused | same |
| Orphan, duplicate business key, unsupported value rejected | same |
| Target collision, changed source row, deleted ledger row rejected | same |
| Apply requires the exact dry-run hash and refuses partial writes | same |
| Explicit ids, owner scoping, sequence advancement | same |
| Import ledger records the run and every row | same |
| Idempotent exact replay | same |
| Zero-difference reconciliation; count, key, field, owner, sequence drift caught | same |

## Recovery

| Behaviour | Evidence |
|---|---|
| Online backup API, not a byte copy; live database untouched | `test/parity/recovery.test.ts` |
| Manifest with hash, bytes, counts, recency and all three checks | same |
| Read-back verifies bytes, hash and per-table counts | same |
| Manifest identity is derived from the snapshot: app marker, schema-format marker, ordered ledger (ordinal, id, name, checksum) and the marker over it | `test/parity/backupIdentity.test.ts` |
| Same head migration with a divergent history, reordered or missing ledger, wrong app or schema marker: backup refused | same |
| A manifest cannot claim a schema marker its own ledger does not produce | same |
| Identity re-derived after the store read-back and again on the disposable restore | same |
| Restore proves identity before promotion and deletes the file if it does not match | same |
| Restore into a disposable destination, then cleaned up | same |
| Tampered and truncated artifacts fail verification | same |
| Manifest recording a failed check is refused | same |
| Restore refuses an existing or active destination | same |
| No recovery work on startup or any request path | same |
| Artifact keys cannot escape the store root | same |

## Runtime request validation

New refusals only: no valid pinned payload changes behaviour.

| Behaviour | Evidence |
|---|---|
| Body shape, unknown keys, unknown enum values refused with a typed 400 naming the field | `test/parity/keycapTrayValidation.test.ts` |
| Discriminated profile: `rect` bounds, known preset ids, custom MultiPolygon rings with bounded and non-degenerate geometry | same |
| Sizing, floor/pocket/engrave dimensions, bounded pocket count and every pocket field | same |
| `NaN`, `Infinity`, `-Infinity` and numeric strings refused, including raw non-finite JSON | same |
| An invalid body cannot change designs, pockets, library rows or sequences | same |
| Pinned defaults (2.4 / 10 / 0.4, `sizing = {}`, `units = 1`) and the pinned `name is required` / `profile.kind is required` 400s unchanged | same |

## Preserved-but-inactive semantics

Carried across unchanged rather than "fixed", because changing them is a product
decision and this wave is a port.

| Semantic | Status |
|---|---|
| `engrave_mm` / `engraveDepthMm` | Stored and round-trips. Nothing reads it. |
| Pocket `depth_mm` | Stored and round-trips. Every pocket uses the design depth. |
| Pocket `label_mode` | Stored and round-trips, always `guide`. |
| Pocket `shape` and `mirror_x` | Columns exist and legacy values import byte-for-byte, but the API contract does not carry them — exactly as in the pinned route. `shape` is *accepted and validated* on the wire (`rect` or `iso-enter`) and still not written, so an ISO Enter pocket reloads as a rectangle. Confirmed against production data: all 11 rows have `shape = NULL`, including the one labelled "ISO Enter". Asserted by `test/parity/keycapTrayValidation.test.ts`. |
| Custom profile rings | Load, render and export. There is no UI to author one. |
