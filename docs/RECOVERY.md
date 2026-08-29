# Recovery

Backup, verification and restore for the ShapePilot SQLite authority.

The online backup source is bound to the preflighted SQLite descriptor before
the backup API reads it. The manifest records the snapshot's durable authority
ID in addition to app markers, ordered migration ledger, and schema catalog;
read-back, disposable verification, and restore require that exact authority.

## Prohibitions

These are enforced in code and covered by `test/parity/recovery.test.ts`.

- **Never byte-copy a live database.** Backups go through SQLite's online backup
  API. A file copy of an open database can capture a torn page.
- **Never run recovery at startup or inside an HTTP request.** Startup validates
  configuration, migrations and schema identity and nothing else. `/api/ready`
  runs one bounded `SELECT 1` plus a ledger read. `quick_check`,
  `integrity_check` and `foreign_key_check` run only in these commands, and only
  against a *snapshot*.
- **Never restore over a live destination.** Restore is forward-only: it refuses
  an existing path, the active authority, and any path with a journal sidecar.
  It validates an invocation-owned temporary file first, then reserves the
  destination with exclusive create semantics before copying verified bytes.
  A destination created concurrently wins and is never overwritten or deleted.
  The new file is one an operator promotes deliberately.
- **Never leave a failed restore promotable.** Any read-back, identity,
  `quick_check`, `integrity_check`, or foreign-key failure closes the snapshot
  and removes invocation-owned temporary state before the error returns.
  Cleanup deletes the destination only after this invocation has acquired it
  with exclusive create; it never deletes a raced file or sidecar owned by
  another process.
- **Never enable WAL.** Azure Files (SMB) cannot provide the shared memory WAL
  needs. The connection asserts `journal_mode=DELETE` on every open.
- **Never take identity from the running build.** The manifest's authority ID,
  app marker, schema marker and migration ledger are read out of the snapshot,
  and every later stage re-derives them from the bytes in front of it.

## Where artifacts go

`SHAPEPILOT_ARTIFACT_STORE_DIR` points at an external filesystem destination —
a mounted volume or share, not the application's own disk and not this
repository. The commands refuse to run without it.

The store is reached through `lib/recovery/artifactStore.ts`, an object-store
shaped interface (`put`, `putFile`, `get`, `fetchToFile`, `list`, `remove`).
Wave 1 ships the filesystem adapter. An app-owned Blob adapter can be added
behind the same interface without the database or any feature module learning
about Azure. Keys are validated segment by segment and cannot escape the root.
The native filesystem guard opens the root once and traverses every key with
descriptor-relative `openat` plus no-follow semantics, so a raced symlink or
renamed parent cannot redirect reads or writes. Database artifacts are copied
and hashed through bounded descriptor I/O instead of being loaded into process
memory. A store-wide descriptor lock serializes helpers. A backup's database and
manifest are staged as one private directory, checked against their approved
lengths and SHA-256 values, synced, and exposed together by one no-replace
directory rename. The native guard revalidates the exact directory membership
and descriptor-derived inode identities before and after publication. Handled
failures remove only tracked staged objects; crash remnants stay under the
reserved staging prefix for the next locked operation to scavenge. Parent
directories are synced before success is reported.

Forward restore likewise validates the destination and every SQLite sidecar with
no-follow directory-entry metadata. Dangling symlinks and symlinks that resolve
to the reserved destination inode are rejected rather than treated as safe.

## Commands

```bash
export SHAPEPILOT_ARTIFACT_STORE_DIR=/mnt/shapepilot-backups

# Take a backup. Prints the artifact id, bytes, hash and per-table counts.
node scripts/recovery.ts backup

# List stored artifacts.
node scripts/recovery.ts list

# Read one back: bytes, hash, disposable restore, all three checks, counts.
node scripts/recovery.ts verify --artifact 20260828T053625317Z-a879478aa7f6c0ff

# Restore forward into a NEW path. Never promotes anything.
node scripts/recovery.ts restore \
  --artifact 20260828T053625317Z-a879478aa7f6c0ff \
  --to /home/data/shapepilot-restored-20260828.db
```

`backup` and `restore` accept `--database <path>`; all four accept
`--store <path>` to override the configured destination.

## Artifact layout

```
<store root>/
  20260828T053625317Z-a879478aa7f6c0ff/
    shapepilot.sqlite3    the snapshot
    manifest.json         shapepilot.sqlite-backup-manifest.v2
```

The artifact id is the backup's UTC timestamp plus the first 16 hex characters
of the manifest hash, so it is both sortable and content-addressed.

## Manifest

`shapepilot.sqlite-backup-manifest.v2` records:

- app, app version, build id, source commit, backup creation time (UTC);
- `database.format`, `database.file`, `database.sourcePath`;
- `database.bytes` and `database.sha256` of the snapshot;
- the **snapshot-derived identity**, read out of the database file itself and
  never from the running build:
  - `database.appMarker` and `database.schemaFormat`, the rows written by the
    `002-app-identity` migration,
  - `database.migrationLedger[]`, the complete ordered ledger — every entry's
    `ordinal`, `id`, `name` and `checksum`,
  - `database.schemaMarker`, the checksum over that ordered ledger,
  - `database.schemaObjectsSha256`, the checksum over the snapshot's complete
    non-internal `sqlite_schema` catalog,
  - `database.headMigration`, which is only ever the tail of that ledger;
- `database.schemaObjectCount` and per-type counts;
- `database.tables[]`: every table with its row count and, where a timestamp
  column exists, the most recent value in both raw and ISO-8601 UTC form;
- `database.checks`: `quickCheck`, `integrityCheck` and `foreignKeyCheck`, all
  run offline against the snapshot.

A backup that fails any of the three checks throws rather than being written.
A manifest that *records* a failed check is rejected when it is read back.

### Why the ledger, not just the head

Two databases can carry the same head migration id and still be different
lineages — an earlier migration renamed, reordered, dropped, or applied from
different statements. The schema marker is a checksum over the whole ordered
ledger, so any of those produces a different value, and
`validateBackupManifest` recomputes the marker from the ledger the manifest
carries so a manifest cannot assert a marker its own ledger does not produce.

`createBackup` refuses a snapshot whose identity is not the one this build
produces: a foreign app marker, a foreign schema-format marker, a divergent
checksum, a reordered ledger or a missing entry all fail with
`SCHEMA_IDENTITY_MISMATCH`. `test/parity/backupIdentity.test.ts` covers each.

## Verification

`verify` performs a genuine read-back, not a re-read of local state:

1. fetch the manifest from the store and validate its contract;
2. recompute the content-addressed artifact id from the manifest and require it
   to match the requested storage key;
3. fetch the snapshot back out of the store into a fresh disposable directory;
4. compare byte length and SHA-256 against the manifest, and confirm the store
   returned the same bytes that landed on disk;
5. re-derive the app marker, schema catalog checksum, schema marker and ledger
   from those read-back bytes and compare them to the manifest
   (`read-back identity: …` differences);
6. restore those bytes into a second, disposable destination and re-derive the
   identity again there (`disposable restore identity: …` differences);
7. run `quick_check`, `integrity_check` and `foreign_key_check` on the restore;
8. reconcile every table's row count against the manifest;
9. delete the disposable directories, whatever the outcome.

`ok: true` with `differences: []` is the only success. Anything else exits
non-zero.

The identity is therefore proved four times: when the snapshot is taken, when
the manifest is read back out of the store, when the artifact is read back, and
on the disposable restore.

## Restore and promotion

`restore` refuses to overwrite. It materializes a new file, verifies bytes and
hash, re-derives the identity from the restored file and compares it to the
manifest, runs all three checks, and stops. A restored file whose app marker,
ledger order, ledger checksums or schema marker do not match the manifest is
**deleted** and the command fails with `RESTORE_IDENTITY_MISMATCH`, so nothing
promotable is ever left on disk. Promotion is a deliberate operator step:

1. stop the ShapePilot process;
2. move the current authority aside (do not delete it);
3. move the verified restored file into place;
4. start the process and confirm `/api/ready` reports `status: "ready"` with the
   expected `headMigration` and `schemaIdentity` — both read back out of the
   database the process actually opened;
5. retain the previous authority and the source backup through the approved
   soak period.

After the first write to a promoted authority, recovery is forward-only:
returning to an older file would discard accepted writes.

## Operational notes

- The scratch directory for a backup defaults to `.recovery-work` beside the
  database, not the system temp directory, which on App Service is small and not
  on the persistent volume. Override it if the volume is tight.
- Backups are per instance. ShapePilot runs one process, one worker, one
  instance; there is no coordination problem to solve, and none is implemented.
- Off-host private storage remains a deployment-gated follow-up. The complete
  backup, read-back and restore contract is implemented and tested against a
  configured external filesystem destination today; only the Blob adapter and
  its provisioning are outstanding.
