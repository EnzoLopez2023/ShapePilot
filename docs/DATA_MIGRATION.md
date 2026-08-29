# Data migration

How the three inherited keycap tables move from a Hearth backup into
ShapePilot's own database, and how that move is proven correct.

## Absolute rules

1. The tools read **only** a supplied immutable, quiesced backup. They never
   open `/home/data/hearth.db`, never open a database Hearth can write, and
   never write to any source.
2. Source evidence is **mandatory and complete**. Repository, commit, tree,
   version, build, image digest, backup bundle id, backup creation time, file
   name, byte length and SHA-256 are all required. A missing field aborts.
3. The bundle must be the **approved source**. `lib/legacy/approved-source.json`
   is checked in, and an import that does not match it exactly fails before a
   transaction is opened. See "The approved source" below.
4. The target owner is **explicit**. Legacy rows carry no ownership; none is
   invented, defaulted or inferred.
5. Nothing is renamed, remapped, coerced or overwritten. A row is inserted
   exactly as it was, is a proven no-op backed by a completed matching import-ledger
   entry, or the run fails.
6. There is **no partial apply**. One rejected row fails the whole run.
7. A dry run is **strictly read-only**. It cannot create a directory, a file or
   a database, cannot set a persistent pragma and cannot run a migration.
8. There is **no dual write**. One authority at a time.

## The approved source

`lib/legacy/approved-source.json` (`shapepilot.approved-legacy-source.v1`) is
the machine-readable contract copied from the coordinator evidence:
`decomposition-manifest.json`, `production-backup-manifest.json`,
`product-data-baseline.json` and the canonical hash artifact produced by the
coordinator's independent `hash-sqlite-tables.mjs` oracle.

It pins, exactly:

| Field | Value |
|---|---|
| repository | `EnzoLopez2023/Hearth` |
| commit | `f0b05fc1dbf53e8aa26c215d8e858894a2793871` |
| tree | `62cbd35861c511f7c17187c875d19ee6e353b80d` |
| version / build | `2.13.2` / `172` |
| image digest | `sha256:dc4df7e0f966be5b0608e71643d316cc5eba7590b8e56cec482583ab69443140` |
| backup bundle | `20260828T053625317Z-1e0918fd4eea2be7` at `2026-08-28T05:36:25.317Z` |
| source database | `950947840` bytes, sha256 `dc9fb47d269b339a3dcae37279dc3116f37a0635728a2d2b2ac2c511811a5807` |
| owned row counts | designs 2, pockets 11, library 1 |
| source schema identity | sha256 of each table's exact `CREATE` statement, plus its full declared column list |
| canonical table hashes | designs `1897345a…`, pockets `2e18f559…`, library `77dae531…` |
| product hash | `20ce15ff94cf352169959fa8f102f799112b06b724d94f3584d8a8476119d1f8` |
| SQLite sequences | designs 2, pockets 17, library 1 |

Nothing the bundle says about itself is trusted. `lib/legacy/approvalGate.ts`
**recomputes** each `hearth.sqlite-table-canonical.v1` hash from the rows the
bundle actually carries plus the *approved* column metadata, recomputes the
product hash from those, and compares all of it against the approved contract
and against the bundle's own declarations. A single differing byte, row, column
type, count or evidence field fails with `SOURCE_NOT_APPROVED` before the
importer plans anything, so an unapproved bundle cannot write.

The gate also recomputes every pocket-to-design relationship pair from the
canonical pocket rows and requires the bundle relationship block to match
exactly. Apply reconciles approved `sqlite_sequence` values even when every data
row is already an idempotent no-op.

The coordinator's `hash-sqlite-tables.mjs` is deliberately **not** vendored: it
stays outside this repository as an independent oracle, and
`test/parity/approvedSource.test.ts` asserts that ShapePilot's implementation
reproduces values that script produced.

## Initializing a target

A dry run never creates a database. When an empty authority is genuinely wanted:

```bash
npm run db:init                        # the configured SHAPEPILOT_DB_PATH
node scripts/init-db.ts --database ./data/rehearsal.db
```

The server's own bootstrap also creates one where the configuration allows it —
never in production, where an absent file means the volume did not mount.

## Immutability, honestly

SQLite has a URI `immutable=1` flag; `better-sqlite3` does not expose URI
filenames. ShapePilot enforces the same guarantee by other means:

- the backup is refused if a `-journal`, `-wal` or `-shm` sidecar exists, which
  is what "quiesced" actually means;
- the byte length and SHA-256 are verified **before** the file is opened;
- the file is opened `readonly: true, fileMustExist: true`;
- the byte length and SHA-256 are verified **again after closing**, so a source
  that changed during the read aborts the export.

## Contracts

Three versioned JSON documents, all hashed with a stable key-sorted
serialization so the same input always produces the same bytes.

| Contract | Produced by |
|---|---|
| `shapepilot.legacy-export.v2` | `scripts/legacy-export.ts` |
| `shapepilot.legacy-import-report.v1` | `scripts/legacy-import.ts --dry-run` |
| `shapepilot.legacy-reconcile-report.v1` | `scripts/reconcile.ts` |
| `shapepilot.approved-legacy-source.v1` | checked in at `lib/legacy/approved-source.json` |

### Export bundle

```jsonc
{
  "contract": "shapepilot.legacy-export.v2",
  "contractVersion": 2,
  "app": "shapepilot",
  "createdUtc": "…",
  "source": { /* the eleven mandatory evidence fields */ },
  "sourceSchema": { "keycap_tray_designs": "<sha256 of its CREATE statement>", … },
  "canonical": {
    "tableAlgorithm": "hearth.sqlite-table-canonical.v1",
    "productAlgorithm": "hearth.sqlite-product-canonical.v1",
    "product": "ShapePilot",
    "productCanonicalSha256": "<recomputed and checked on import>"
  },
  "tables": [
    {
      "name": "keycap_tray_designs",
      "columns": [ /* the pinned Hearth column list, in the pinned order */ ],
      "rowCount": 2,
      "primaryKeys": [1, 2],
      "rowsHash": "<order-independent sha256 of the row hashes>",
      "schema": {
        "createSqlSha256": "<sha256 of the source CREATE statement>",
        "primaryKey": ["id"],
        "columns": [ { "name": "id", "type": "INTEGER", "notNull": false,
                       "primaryKeyOrder": 1 }, … ]
      },
      "canonicalSha256": "<hearth.sqlite-table-canonical.v1 of this table>",
      "rows": [ [ ["i","1"], ["s","Test Tray"], ["n"], … ] ]
    }
  ],
  "relationships": [
    { "child": "keycap_tray_pockets", "parent": "keycap_tray_designs",
      "column": "design_id", "pairs": [[7,1], …] }
  ],
  "sqliteSequence": [ { "name": "keycap_tray_designs", "seq": 2 }, … ]
}
```

Values are type-tagged so the integer `1`, the float `1.0` and the string `"1"`
can never collide: `["n"]` null, `["i","…"]` integer as a decimal string (safe
past 2^53), `["f", …]` float, `["s", …]` text, `["b", …]` base64 blob.

Row order is deterministic — designs and library by `id`, pockets by
`design_id, sort_order, id` — so two exports of the same backup are byte-identical.

## Owner mapping

Legacy rows are unscoped. `--owner-tenant` and `--owner-oid` must both be
GUIDs, and every imported design and library row is written with them.
Pockets inherit ownership through `design_id`; they have no owner columns, which
is why reconciliation checks them through a join.

The assignment is recorded in `legacy_import_runs` alongside the bundle hash,
source commit, source SHA-256 and the dry-run report hash. That hash also binds
the target database's durable `authority_id`, so approval for one initialized
authority cannot authorize another. Who was given which rows, from which
artifact and into which authority is therefore auditable.

## Procedure

Artifacts do not belong in this repository. Write them somewhere outside it.

```bash
# 0. Prove the backup is the approved one.
shasum -a 256 /path/to/hearth.sqlite3
#   must be dc9fb47d269b339a3dcae37279dc3116f37a0635728a2d2b2ac2c511811a5807
#   and the file must be exactly 950947840 bytes

# 1. Run the coordinator's independent source-side canonical oracle and compare
#    its output with production-canonical-hashes.json before trusting the export.
node /path/to/hash-sqlite-tables.mjs \
  /path/to/hearth.sqlite3 \
  /path/to/decomposition-manifest.json \
  /path/outside/repo/canonical-hashes-rerun.json

# 2. Export.
node scripts/legacy-export.ts \
  --backup   /path/to/hearth.sqlite3 \
  --evidence /path/outside/repo/source-evidence.json \
  --out      /path/outside/repo/legacy-export.json

# 3. Dry run. Read-only: opens the target `readonly` + `query_only`, creates
#    nothing, migrates nothing, and prints the report hash. If the target does
#    not exist yet, run `npm run db:init` first — the dry run will not make one.
node scripts/legacy-import.ts --dry-run \
  --bundle       /path/outside/repo/legacy-export.json \
  --owner-tenant <tenant-guid> \
  --owner-oid    <object-id-guid> \
  --report       /path/outside/repo/import-report.json

# 4. Apply, gated on the exact hash the dry run printed.
node scripts/legacy-import.ts --apply \
  --bundle       /path/outside/repo/legacy-export.json \
  --owner-tenant <tenant-guid> \
  --owner-oid    <object-id-guid> \
  --report-hash  <hash from step 2>

# 5. Reconcile independently. Exits non-zero on any difference.
node scripts/reconcile.ts \
  --bundle       /path/outside/repo/legacy-export.json \
  --owner-tenant <tenant-guid> \
  --owner-oid    <object-id-guid> \
  --report       /path/outside/repo/reconcile-report.json
```

All of them accept `--database <path>` to target a specific database; without it
they use `SHAPEPILOT_DB_PATH`. `--dry-run` and `scripts/reconcile.ts` open that
database read-only (`readonly`, `fileMustExist`, `query_only = ON`) and validate
its app marker and complete ordered migration ledger before planning anything;
`--apply` is the only command in this file that writes. It opens only an
already-initialized database whose complete current ShapePilot identity matches
this build, including the hash of the actual `sqlite_schema` catalog; it proves
that identity before setting persistent pragmas and never runs migrations on an
import target. Apply acquires SQLite's single-writer reservation with
`BEGIN IMMEDIATE` before recomputing the approved plan, so a concurrent write
cannot make the dry-run report stale between validation and use.

## Dispositions

Every source row lands in exactly one bucket.

| Disposition | Meaning |
|---|---|
| `insert` | New row; will be written with its explicit legacy id. |
| `noop` | Byte-identical row already present and owned by this owner. |
| `reject` | Run fails. Codes below. |

| Reject code | Cause |
|---|---|
| `PRIMARY_KEY_INVALID` | Row has no usable integer id. |
| `DUPLICATE_PRIMARY_KEY` | The bundle contains the same id twice. |
| `UNSUPPORTED_VALUE` | Wrong type, non-finite number, or unparseable `profile_json`/`sizing_json`. |
| `ORPHAN_ROW` | Pocket references a `design_id` not in the bundle. |
| `DUPLICATE_BUSINESS_KEY` | Two library pockets share a name, or the owner already has that name. |
| `TARGET_COLLISION` | The id exists in the target and belongs to a different owner. |
| `SOURCE_CHANGED` | The id exists in the target with different content. |
| `LEDGER_ROW_DELETED` | The row was imported before and has since been deleted; re-inserting would resurrect it. |

Bundle-level failures abort before any disposition is computed:
`SOURCE_NOT_APPROVED`, `STORAGE_CLASS_MISMATCH`, `EXPORT_TAMPERED`,
`EXPORT_COLUMNS_INVALID`, `EXPORT_ROWS_INVALID`, `EXPORT_SCHEMA_INVALID`,
`EXPORT_CANONICAL_INVALID`, `EXPORT_SEQUENCE_INVALID`,
`SOURCE_EVIDENCE_INVALID`, `SOURCE_BYTES_MISMATCH`,
`SOURCE_HASH_MISMATCH`, `SOURCE_NOT_QUIESCED`, `SOURCE_MUTATED`,
`OWNER_REQUIRED`, `REPORT_HASH_MISMATCH`, `IMPORT_REJECTED`.

Target-level failures abort before the target is even read:
`TARGET_MISSING` (no database at the path — a dry run never creates one),
`TARGET_UNREADABLE`, `APP_MARKER_MISSING`, `SCHEMA_MARKER_MISSING`,
`MIGRATION_LEDGER_EMPTY` and `SCHEMA_IDENTITY_MISMATCH` (the ledger, its order,
its checksums or the app marker are not the ones this build ships).

## What reconciliation proves

`scripts/reconcile.ts` does not trust the importer. It re-reads both sides and
proves, independently:

- table row counts,
- primary key sets (naming exactly which ids are missing or unexpected),
- canonical field hashes per row, naming the differing row,
- the library business key is unique per owner,
- every design and library row is scoped to the reconciled owner and no other,
- the `keycap_tray_pockets.design_id → keycap_tray_designs.id` pair set,
- no orphan pockets anywhere in the table,
- `sort_order` is monotonic within each design,
- `sqlite_sequence` is at least the source value for all three tables.

Success is `differences: []` and `ok: true`. Anything else exits non-zero.

## Verified against the real dataset

The approved production backup — 950947840 bytes, SHA-256
`dc9fb47d269b339a3dcae37279dc3116f37a0635728a2d2b2ac2c511811a5807`, taken
`2026-08-28T05:36:25.317Z` from commit
`f0b05fc1dbf53e8aa26c215d8e858894a2793871` — was hash-verified and exported
read-only. Recorded results:

| Table | Rows | Source oracle `canonicalSha256` | ShapePilot export `rowsHash` |
|---|---:|---|---|
| `keycap_tray_designs` | 2 | `1897345a4e6d978da36c531b0da34edf669a8e3577c8de2bb72de1ed5c5e4172` | `63241e1d21fda1fbb210b31a29effc6df8d1e7cf8dd1cbe72aed78888950a166` |
| `keycap_tray_pockets` | 11 | `2e18f559e62b862f9945522ccfbcd5f09cf8c1fa2a7e524afa9d498f7a98cf02` | `3f6a33ac876daa1ff5992ff0ad8075134b174bd4e4ee132f521001ca51846522` |
| `keycap_pocket_library` | 1 | `77dae531d34bfce1d010a6a6dd04bd51e71255a60b4869fc9a0ed7580066d8fe` | `421b99ed00f661536ee899aa3f695f9595bb4c2a592a45974b2ec7c246adac3e` |

The source oracle aggregate for ShapePilot is
`20ce15ff94cf352169959fa8f102f799112b06b724d94f3584d8a8476119d1f8`
for exactly three tables and 14 rows. Its complete rerun output matched the
coordinator-provided oracle byte-for-byte after paths were excluded from the
comparison.

`sqlite_sequence`: designs 2, pockets 17, library 1. The import approval gate
requires those exact names, order, safe-integer values, and approved values
before planning or writing. Because `createdUtc` defaults to the evidence's
immutable backup timestamp, repeated exports are byte-identical. The stable v2
bundle hash is
`e6a5c65395f3f2309bd93d56c86db19d2c1974c62406ee6cc5acd87686e991d6`.

Dry run planned 14 inserts, 0 no-ops, 0 rejects. Apply wrote all 14 in one
transaction. Reconciliation reported **zero unexplained differences**. Replaying
the same bundle planned 0 inserts and 14 no-ops. The counts match
`product-data-baseline.json` exactly (2 / 11 / 1).

That rehearsal ran against a disposable target outside the repository. Neither
the backup nor any derived artifact is committed here.

## Cutover and rollback

Cutover is coordinated separately from this repository and is **not** performed
by any script in it.

1. Quiesce the keycap tray domain in Hearth: stop writes, confirm no session is
   mid-edit.
2. Capture and approve a fresh backup; record its bytes and SHA-256.
3. Export, dry run, apply, reconcile — as above, into the production ShapePilot
   database.
4. Promote ShapePilot as the single authority for the domain and record the
   timestamp of its first committed write.
5. Retain the Hearth backup and the old read-only authority through the approved
   soak period.

Rollback is only available **before** the first ShapePilot write. After that,
recovery is forward-only (see `docs/RECOVERY.md`); returning to Hearth would
mean losing writes that ShapePilot has accepted.
