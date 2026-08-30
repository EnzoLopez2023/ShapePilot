// App-owned schema. Statements are literal SQL so the migration checksum is a
// checksum of exactly what runs, and so a reviewer can diff the shipped DDL
// against the pinned Hearth DDL column for column.
//
// Three tables are inherited from Hearth production commit
// f0b05fc1dbf53e8aa26c215d8e858894a2793871 and keep their names, column names,
// types, defaults, nullability, cascade and ordering semantics. The only
// additions are the owner columns ShapePilot needs to scope rows to an
// authenticated `(tenant_id, oid)` identity, which the monolith did not have.

/**
 * Bookkeeping for the append-only migration ledger. `name` is stored alongside
 * `id` so a snapshot carries the human-readable migration name without having
 * to consult the running build.
 */
export const MIGRATION_LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          TEXT    PRIMARY KEY,
  checksum    TEXT    NOT NULL,
  applied_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  ordinal     INTEGER NOT NULL,
  name        TEXT    NOT NULL DEFAULT ''
)`

export const INITIAL_STATEMENTS: readonly string[] = [
  // -- App-local identity -----------------------------------------------------
  // `(tenant_id, oid)` is the only authorization key. Display name and email are
  // audit/display fields and are never used to decide access.
  `CREATE TABLE app_memberships (
  tenant_id     TEXT NOT NULL,
  oid           TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  display_name  TEXT,
  email         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, oid)
)`,

  `CREATE TABLE app_settings (
  tenant_id     TEXT NOT NULL,
  oid           TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, oid)
)`,

  // Bounded detail column; the writer truncates rather than the reader.
  `CREATE TABLE audit_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at     TEXT NOT NULL DEFAULT (datetime('now')),
  actor_tenant_id TEXT,
  actor_oid       TEXT,
  category        TEXT NOT NULL,
  action          TEXT NOT NULL,
  outcome         TEXT NOT NULL,
  http_method     TEXT,
  http_path       TEXT,
  http_status     INTEGER,
  request_id      TEXT,
  subject         TEXT,
  detail          TEXT
)`,
  `CREATE INDEX idx_audit_events_time ON audit_events (occurred_at DESC, id DESC)`,
  `CREATE INDEX idx_audit_events_actor ON audit_events (actor_tenant_id, actor_oid, occurred_at DESC)`,
  `CREATE INDEX idx_audit_events_category ON audit_events (category, occurred_at DESC)`,

  // -- Legacy-owned keycap tables --------------------------------------------
  // Column list, types, defaults and nullability are the pinned Hearth
  // definitions. `owner_tenant_id`/`owner_oid` are the ShapePilot additions.
  `CREATE TABLE keycap_tray_designs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_tenant_id TEXT    NOT NULL,
  owner_oid       TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  notes           TEXT,
  profile_kind    TEXT    NOT NULL,
  profile_json    TEXT    NOT NULL,
  sizing_json     TEXT    NOT NULL,
  floor_mm        REAL    NOT NULL DEFAULT 2.4,
  depth_mm        REAL    NOT NULL DEFAULT 10.0,
  engrave_mm      REAL    NOT NULL DEFAULT 0.4,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE INDEX idx_keycap_designs_owner
  ON keycap_tray_designs (owner_tenant_id, owner_oid, updated_at DESC)`,

  // Pockets inherit ownership through design_id; the cascade is the pinned one.
  // `mirror_x` and `shape` exist in the pinned production schema and are carried
  // forward unchanged so legacy rows import byte-for-byte. See
  // docs/PARITY_CHECKLIST.md — the pinned route never reads or writes them.
  `CREATE TABLE keycap_tray_pockets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  design_id     INTEGER NOT NULL REFERENCES keycap_tray_designs (id) ON DELETE CASCADE,
  units         REAL    NOT NULL,
  height_units  REAL    NOT NULL DEFAULT 1,
  x_mm          REAL    NOT NULL,
  y_mm          REAL    NOT NULL,
  rotation_deg  INTEGER NOT NULL DEFAULT 0,
  is_through    INTEGER NOT NULL DEFAULT 0,
  label         TEXT,
  label_mode    TEXT    NOT NULL DEFAULT 'guide',
  depth_mm      REAL,
  width_mm      REAL,
  height_mm     REAL,
  corner_mm     REAL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  mirror_x      INTEGER NOT NULL DEFAULT 0,
  shape         TEXT
)`,
  `CREATE INDEX idx_keycap_pockets_design
  ON keycap_tray_pockets (design_id, sort_order)`,

  // The pinned table had a global UNIQUE(name). Ownership makes that
  // owner-scoped: two people may each keep a pocket called "14mm square".
  `CREATE TABLE keycap_pocket_library (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_tenant_id TEXT    NOT NULL,
  owner_oid       TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  units           REAL    NOT NULL DEFAULT 1,
  width_mm        REAL,
  height_mm       REAL,
  corner_mm       REAL,
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner_tenant_id, owner_oid, name)
)`,

  // -- Legacy import ledger ---------------------------------------------------
  // Keyed by source manifest hash so an accepted import is auditable and an
  // identical replay is provably a no-op.
  `CREATE TABLE legacy_import_runs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  source_manifest_hash TEXT NOT NULL,
  source_commit        TEXT NOT NULL,
  source_sha256        TEXT NOT NULL,
  source_bytes         INTEGER NOT NULL,
  owner_tenant_id      TEXT NOT NULL,
  owner_oid            TEXT NOT NULL,
  report_hash          TEXT NOT NULL,
  started_at           TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at         TEXT,
  UNIQUE (source_manifest_hash, owner_tenant_id, owner_oid)
)`,
  `CREATE TABLE legacy_import_rows (
  run_id       INTEGER NOT NULL REFERENCES legacy_import_runs (id) ON DELETE CASCADE,
  source_table TEXT    NOT NULL,
  source_id    INTEGER NOT NULL,
  target_id    INTEGER NOT NULL,
  row_hash     TEXT    NOT NULL,
  PRIMARY KEY (source_table, source_id)
)`,
  `CREATE INDEX idx_legacy_import_rows_run ON legacy_import_rows (run_id)`,
]

/**
 * Durable app/schema identity, written into the database itself.
 *
 * A backup manifest, a restore and a read-only import inspection all have to
 * decide "is this file a ShapePilot authority produced by this lineage?" from
 * the file alone. The migration ledger answers the schema half; these rows
 * answer the app half, and both survive a byte-for-byte copy.
 */
export const APP_IDENTITY_STATEMENTS: readonly string[] = [
  `CREATE TABLE app_identity (
  key    TEXT NOT NULL PRIMARY KEY,
  value  TEXT NOT NULL
)`,
  `INSERT INTO app_identity (key, value) VALUES ('app', 'shapepilot')`,
  `INSERT INTO app_identity (key, value) VALUES ('schema_format', 'shapepilot.schema-identity.v1')`,
  `INSERT INTO app_identity (key, value) VALUES ('authority_id', lower(hex(randomblob(16))))`,
]

/**
 * Design documents for the Shaper, Bambu and Playground sub-apps.
 *
 * One table for all three kinds, deliberately: opening a Bambu model in the
 * Shaper Designer is a product requirement, and three near-identical tables
 * would make every cross-app query a union. The scene tree lives in doc_json
 * because it is a nested, freeform structure -- normalising it the way
 * keycap_tray_pockets is normalised would buy nothing, since nothing queries
 * inside a scene.
 *
 * Imported STL and SVG bytes are NOT here. PRODUCT.md keeps fabrication data
 * out of the database; the document stores a content hash and the browser keeps
 * the bytes.
 */
export const DESIGN_DOCUMENT_STATEMENTS: readonly string[] = [
  `CREATE TABLE design_documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_tenant_id TEXT    NOT NULL,
  owner_oid       TEXT    NOT NULL,
  kind            TEXT    NOT NULL CHECK (kind IN ('shaper', 'bambu', 'playground')),
  name            TEXT    NOT NULL,
  notes           TEXT,
  doc_json        TEXT    NOT NULL,
  object_count    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE INDEX idx_design_documents_owner
  ON design_documents (owner_tenant_id, owner_oid, kind, updated_at DESC)`,
]

/**
 * Metadata for imported design assets. The bytes live behind the artifact store
 * (docs/ARCHITECTURE.md, "The artifact-store boundary"), never in here -- this
 * table holds only the content hash that keys them, plus enough to show the
 * object in a UI.
 *
 * Assets are deliberately NOT authoritative. The backup manifest describes one
 * SQLite file, and nothing here changes that; a missing asset degrades to
 * "re-attach this file" rather than breaking the document that references it.
 */
export const DESIGN_ASSET_STATEMENTS: readonly string[] = [
  `CREATE TABLE design_assets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_tenant_id TEXT    NOT NULL,
  owner_oid       TEXT    NOT NULL,
  hash            TEXT    NOT NULL,
  filename        TEXT    NOT NULL,
  format          TEXT    NOT NULL,
  byte_length     INTEGER NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
  // A hash is content, not a capability: lookups are always scoped by owner, so
  // knowing someone else's hash reveals nothing. The uniqueness is per owner
  // for the same reason.
  `CREATE UNIQUE INDEX idx_design_assets_owner_hash
  ON design_assets (owner_tenant_id, owner_oid, hash)`,
]

/** Tables ShapePilot owns and reconciles. Order is the reconciliation order. */
export const OWNED_LEGACY_TABLES = [
  'keycap_tray_designs',
  'keycap_tray_pockets',
  'keycap_pocket_library',
] as const

export type OwnedLegacyTable = (typeof OWNED_LEGACY_TABLES)[number]
