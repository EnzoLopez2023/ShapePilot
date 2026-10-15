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

/**
 * Keycap projects: one keycap set, the caps it holds, photos of it, and the
 * trays cut for it.
 *
 * A project is the level at which a *set* is described, because that is the
 * level at which sets differ: two Systainer trays cut for the same set share
 * one inventory, and the same tray outline cut for a different set does not.
 *
 * `keycap_set_items` is one row per distinct cap rather than a size histogram.
 * The 1u(35) / 1.25u(5) breakdown a person wants to read is an aggregate over
 * these rows, and storing the aggregate instead would throw away the legends --
 * which are the part a photo actually shows, and the part that can later seed a
 * pocket label.
 *
 * `keycap_project_photos.hash` names a row in `design_assets` but is
 * deliberately NOT a foreign key into it. Assets are non-authoritative (see
 * docs/ARCHITECTURE.md, "The artifact-store boundary"): the route proves the
 * hash is owned at write time, and a photo whose bytes have gone missing
 * degrades to "re-attach this file" rather than making the project unreadable.
 */
export const KEYCAP_PROJECT_STATEMENTS: readonly string[] = [
  `CREATE TABLE keycap_projects (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_tenant_id TEXT    NOT NULL,
  owner_oid       TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  notes           TEXT,
  set_name        TEXT,
  manufacturer    TEXT,
  cap_profile     TEXT,
  colorway        TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE INDEX idx_keycap_projects_owner
  ON keycap_projects (owner_tenant_id, owner_oid, updated_at DESC)`,

  // Items inherit ownership through project_id, exactly as pockets do through
  // design_id. `cap_count` rather than `count`: the latter is a SQL function
  // name and reads as one in every query that touches it.
  `CREATE TABLE keycap_set_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES keycap_projects (id) ON DELETE CASCADE,
  legend       TEXT,
  units        REAL    NOT NULL DEFAULT 1,
  height_units REAL    NOT NULL DEFAULT 1,
  shape        TEXT,
  cap_count    INTEGER NOT NULL DEFAULT 1,
  group_name   TEXT,
  color        TEXT,
  source       TEXT    NOT NULL DEFAULT 'manual',
  sort_order   INTEGER NOT NULL DEFAULT 0
)`,
  `CREATE INDEX idx_keycap_set_items_project
  ON keycap_set_items (project_id, sort_order)`,

  `CREATE TABLE keycap_project_photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES keycap_projects (id) ON DELETE CASCADE,
  hash       TEXT    NOT NULL,
  caption    TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, hash)
)`,

  // A tray belongs to at most one project, so this is a column rather than a
  // join table. SQLite allows ADD COLUMN to carry a REFERENCES clause only when
  // the default is NULL -- which is also the migration behaviour wanted here:
  // every tray that already exists lands unassigned.
  //
  // ON DELETE SET NULL, not CASCADE: deleting the description of a keycap set
  // must never destroy the designs cut for it.
  `ALTER TABLE keycap_tray_designs
  ADD COLUMN project_id INTEGER REFERENCES keycap_projects (id) ON DELETE SET NULL`,
  `CREATE INDEX idx_keycap_designs_project
  ON keycap_tray_designs (project_id, updated_at DESC)`,
]

/**
 * Corner-spacer posts for stacking a tray inside a Systainer. One nullable JSON
 * column, same shape as `sizing_json`: `{"heightMm":7,"sizeMm":10}` or NULL for
 * a tray with no spacers, which is every tray imported from Hearth.
 */
export const CORNER_SPACER_STATEMENTS: readonly string[] = [
  `ALTER TABLE keycap_tray_designs ADD COLUMN corner_spacers_json TEXT`,
]

/**
 * Locating posts: one hollow post per 1u slot in a pocket, so several 1u
 * keycaps sharing one long pocket each get a home. Per-pocket, so the column
 * lands on keycap_tray_pockets. Same nullable-JSON shape as the others:
 * `{"heightMm":3,"outerDiameterMm":6,"boreDiameterMm":4}` or NULL for a pocket
 * with none, which is every pocket that exists before this migration.
 */
export const LOCATING_POST_STATEMENTS: readonly string[] = [
  `ALTER TABLE keycap_tray_pockets ADD COLUMN locating_posts_json TEXT`,
]

/**
 * Nameplate: raised text of the tray name on the floor. Design-level, one per
 * tray, so the column lands on `keycap_tray_designs`. Same nullable-JSON shape
 * as `corner_spacers_json`: `{"heightMm":2,"fontSizeMm":8,"x":124,"y":150}` or
 * NULL for a tray with none, which is every tray before this migration.
 */
export const NAMEPLATE_STATEMENTS: readonly string[] = [
  `ALTER TABLE keycap_tray_designs ADD COLUMN nameplate_json TEXT`,
]

/**
 * Which filaments an account owns. One row per owned (filament, variant); the
 * absence of a row is "not owned", which is the only other state there is.
 *
 * Sparse rather than a row per catalogue entry with boolean columns. The
 * catalogue is committed code (lib/contracts/bambuFilaments.ts), not data, so a
 * new colour -- or a whole new brand -- must never be a migration. A dense table
 * would also need 108 rows per account to say nothing, and seeding them would
 * both put a write on a read path and break the empty-seed proof, which requires
 * every domain table to be empty after bootstrap.
 *
 * `filament_key` names a row in that catalogue and is deliberately something
 * the database cannot check. The route validates membership; a colour retired
 * from the catalogue leaves a harmless tick nobody can see rather than making
 * the inventory unreadable.
 *
 * `variant` is NOT NULL even for the lines sold only on a reel, which carry
 * 'spool': SQLite treats NULLs as distinct inside a UNIQUE index, so a nullable
 * variant would let the same filament be ticked twice.
 *
 * No `updated_at`: a tick is created and destroyed, never edited. No separate
 * index either -- the implicit UNIQUE index already leads with the owner pair,
 * which is the only way this table is ever read.
 */
export const FILAMENT_INVENTORY_STATEMENTS: readonly string[] = [
  `CREATE TABLE filament_inventory (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_tenant_id TEXT    NOT NULL,
  owner_oid       TEXT    NOT NULL,
  filament_key    TEXT    NOT NULL,
  variant         TEXT    NOT NULL CHECK (variant IN ('spool', 'refill')),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner_tenant_id, owner_oid, filament_key, variant)
)`,
]

/**
 * `quantity` on `filament_inventory` -- how many of a filament are on the shelf.
 *
 * A row still means "owned" and an absent row still means "not owned", so the
 * count is never zero: unticking deletes the row, exactly as before. Bounded
 * above because a count is typed and stepped by hand, and 999 spools of one
 * colour is a typo, not an inventory.
 *
 * Additive with a default of 1, so every tick that exists before this
 * migration reads back as the one spool it always meant.
 */
export const FILAMENT_QUANTITY_STATEMENTS: readonly string[] = [
  `ALTER TABLE filament_inventory
  ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 999)`,
]

/**
 * `filament_prices` -- what a kilogram of a line costs this account.
 *
 * Per line, not per colour: Bambu prices a line, and a spool of Jade White
 * costs what a spool of Bambu Black costs. One row per priced line, and an
 * absent row means "not priced", which is the honest default -- a cost figure
 * invented from a guessed price is worse than no cost figure.
 *
 * `line_id` names a line in the committed catalogue, the way `filament_key`
 * names a colour: the database cannot check it, the route can, and a line that
 * leaves the catalogue leaves a harmless row rather than an unreadable table.
 *
 * The currency is stored per row and validated as an ISO 4217 code. It is the
 * account's own; nothing here converts between currencies, and a mixed set is
 * shown as the mixture it is rather than being summed into a fiction.
 */
export const FILAMENT_PRICE_STATEMENTS: readonly string[] = [
  `CREATE TABLE filament_prices (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_tenant_id TEXT    NOT NULL,
  owner_oid       TEXT    NOT NULL,
  line_id         TEXT    NOT NULL,
  price_per_kg    REAL    NOT NULL CHECK (price_per_kg > 0 AND price_per_kg <= 100000),
  currency        TEXT    NOT NULL CHECK (length(currency) = 3),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner_tenant_id, owner_oid, line_id)
)`,
]

/**
 * Filament orders -- what an account bought, which is now what it owns.
 *
 *   `filament_orders`           one row per order: a store invoice, or a manual
 *                               entry for rolls with no invoice behind them (a
 *                               shop counter, a gift). The store's order number
 *                               is unique per account, so the same invoice
 *                               uploaded twice is refused rather than doubled;
 *                               a manual entry has none. Order-level money --
 *                               discount, store credit, shipping -- is stored as
 *                               printed, positive, and shared out over the lines
 *                               when a roll's landed cost is worked out
 *                               (lib/contracts/filamentOrders.ts).
 *
 *   `filament_order_lines`      every line of an order, filament or not: a
 *                               hotend on the same invoice still takes its share
 *                               of the order's credit and shipping. A line that
 *                               is not filament has no key and no variant.
 *                               `unit_price` NULL is "not known" (a gift), never
 *                               zero.
 *
 *                               The original invoice -- a PDF, or a photo of a
 *                               paper receipt -- is kept for reference in the
 *                               asset store, owner-scoped and content-addressed
 *                               like a set photo, and named here by its hash.
 *                               Like every asset it is not authoritative: the
 *                               order is the record, the file is the receipt.
 *
 *   `filament_roll_adjustments` rolls of a colour a person has marked used up,
 *                               for when the reel runs out before the slicer's
 *                               gram estimates say it should.
 *
 * Nothing here stores rolls on hand, grams left or a price per kilogram. Those
 * are derived from these rows and the print history every time, so they can
 * never disagree with what was bought or printed. `filament_inventory` and
 * `filament_prices`, which held the ticks and line prices this replaces, are
 * left in place and no longer read.
 */
export const FILAMENT_ORDER_STATEMENTS: readonly string[] = [
  `CREATE TABLE filament_orders (
  id              TEXT    PRIMARY KEY,
  owner_tenant_id TEXT    NOT NULL,
  owner_oid       TEXT    NOT NULL,
  source          TEXT    NOT NULL CHECK (source IN ('bambu-us-invoice', 'manual')),
  order_number    TEXT    CHECK (order_number IS NULL OR length(order_number) BETWEEN 1 AND 80),
  ordered_at      TEXT    NOT NULL CHECK (ordered_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  currency        TEXT    NOT NULL CHECK (length(currency) = 3),
  order_discount  REAL    NOT NULL DEFAULT 0 CHECK (order_discount >= 0),
  credit          REAL    NOT NULL DEFAULT 0 CHECK (credit >= 0),
  shipping        REAL    NOT NULL DEFAULT 0 CHECK (shipping >= 0),
  grand_total     REAL    CHECK (grand_total IS NULL OR grand_total >= 0),
  note            TEXT    CHECK (note IS NULL OR length(note) <= 500),
  invoice_hash    TEXT    CHECK (invoice_hash IS NULL OR (length(invoice_hash) = 64 AND invoice_hash NOT GLOB '*[^0-9a-f]*')),
  invoice_name    TEXT    CHECK (invoice_name IS NULL OR length(invoice_name) BETWEEN 1 AND 200),
  invoice_type    TEXT    CHECK (invoice_type IS NULL OR invoice_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  invoice_bytes   INTEGER CHECK (invoice_bytes IS NULL OR invoice_bytes > 0),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK ((invoice_hash IS NULL) = (invoice_name IS NULL)
     AND (invoice_hash IS NULL) = (invoice_type IS NULL)
     AND (invoice_hash IS NULL) = (invoice_bytes IS NULL))
)`,
  `CREATE UNIQUE INDEX idx_filament_orders_number
  ON filament_orders (owner_tenant_id, owner_oid, order_number)
  WHERE order_number IS NOT NULL`,
  `CREATE INDEX idx_filament_orders_owner
  ON filament_orders (owner_tenant_id, owner_oid, ordered_at)`,
  `CREATE TABLE filament_order_lines (
  order_id        TEXT    NOT NULL REFERENCES filament_orders (id) ON DELETE CASCADE,
  position        INTEGER NOT NULL CHECK (position >= 0),
  filament_key    TEXT,
  variant         TEXT    CHECK (variant IS NULL OR variant IN ('spool', 'refill')),
  description     TEXT    NOT NULL CHECK (length(description) BETWEEN 1 AND 300),
  sku             TEXT    CHECK (sku IS NULL OR length(sku) <= 120),
  grams_per_unit  INTEGER NOT NULL CHECK (grams_per_unit BETWEEN 0 AND 10000),
  quantity        INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  unit_price      REAL    CHECK (unit_price IS NULL OR unit_price >= 0),
  discount        REAL    NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax             REAL    NOT NULL DEFAULT 0 CHECK (tax >= 0),
  PRIMARY KEY (order_id, position),
  CHECK ((filament_key IS NULL) = (variant IS NULL))
)`,
  `CREATE TABLE filament_roll_adjustments (
  owner_tenant_id TEXT    NOT NULL,
  owner_oid       TEXT    NOT NULL,
  filament_key    TEXT    NOT NULL,
  finished        INTEGER NOT NULL CHECK (finished BETWEEN 1 AND 999),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (owner_tenant_id, owner_oid, filament_key)
)`,
]

/**
 * `filament_usage_mappings` -- what a recorded print's filament *is*.
 *
 * A print reports a material, a preset filament ID and an AMS colour, and most
 * of the time lib/contracts/filamentUsage.ts can turn that into a catalogue
 * colour on its own. When it cannot -- a colour no catalogue line sells, a
 * third-party spool, a preset that disagrees with its colour -- the account
 * says so here, once, and every later print reporting the same thing follows.
 *
 * The source triple is stored normalised with unreported fields as '', so it
 * can be unique. `filament_key` NULL means "don't track this filament": the
 * usage is set aside rather than left nagging in the unmatched list.
 */
export const FILAMENT_USAGE_MAPPING_STATEMENTS: readonly string[] = [
  `CREATE TABLE filament_usage_mappings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_tenant_id TEXT    NOT NULL,
  owner_oid       TEXT    NOT NULL,
  material        TEXT    NOT NULL,
  filament_id     TEXT    NOT NULL,
  color           TEXT    NOT NULL CHECK (color = '' OR color GLOB '#[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]'),
  filament_key    TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner_tenant_id, owner_oid, material, filament_id, color)
)`,
]

/**
 * Web Push: where to reach an account, and what it has already been told.
 *
 *   `push_subscriptions`       one row per browser that turned reminders on. The
 *                              endpoint is the push service's URL for that one
 *                              browser and is unique on its own; the two keys
 *                              are what the payload is encrypted to. A push
 *                              service answering 404 or 410 means the browser
 *                              is gone, and the row is deleted.
 *
 *   `filament_reorder_alerts`  one row per colour an account has been told to
 *                              reorder and that still needs it. The row is what
 *                              stops the ten-minute check repeating itself; it
 *                              is deleted when the colour stops needing a
 *                              reorder, which re-arms it for next time.
 */
export const PUSH_STATEMENTS: readonly string[] = [
  `CREATE TABLE push_subscriptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_tenant_id TEXT    NOT NULL,
  owner_oid       TEXT    NOT NULL,
  endpoint        TEXT    NOT NULL UNIQUE CHECK (endpoint LIKE 'https://%'),
  p256dh          TEXT    NOT NULL,
  auth            TEXT    NOT NULL,
  user_agent      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  last_sent_at    TEXT
)`,
  `CREATE INDEX idx_push_subscriptions_owner
  ON push_subscriptions (owner_tenant_id, owner_oid)`,
  `CREATE TABLE filament_reorder_alerts (
  owner_tenant_id TEXT NOT NULL,
  owner_oid       TEXT NOT NULL,
  filament_key    TEXT NOT NULL,
  notified_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (owner_tenant_id, owner_oid, filament_key)
)`,
]

/**
 * Switch trays: a plate a mechanical keyboard switch passes through, with posts
 * underneath so a stack of them lives in a Systainer.
 *
 * One table and no per-cell rows, because a switch tray has none to store. Every
 * cell is the same square and the layout is *generated* from the pitch, margin
 * and outline (see src/features/switch-tray/geometry/fill.ts), so what persists
 * is the handful of parameters that generate it -- a tray holding 130 switches
 * is one row, and re-opening it recomputes the same 130 cells.
 *
 * The JSON columns follow the shape the keycap tray already uses for
 * `sizing_json` and `corner_spacers_json`: a validated object, or NULL where the
 * feature is absent.
 *
 *   switch_json        the resolved switch profile, stored whole rather than by
 *                      id -- the user may have measured their own switches, and
 *                      a tray must keep printing the same after a catalogue edit
 *   plate_json         retention, shelf and recess thickness, clearances
 *   fill_json          pitch, margin, stagger, origin, spread
 *   feet_json          posts, or NULL for a tray that does not stack
 *   nameplate_json     raised name on the plate, or NULL
 *   skipped_cells_json cells the user clicked out of the grid, or NULL
 *   case_clear_mm      override for the profile preset's own clear height
 */
export const SWITCH_TRAY_STATEMENTS: readonly string[] = [
  `CREATE TABLE switch_tray_designs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_tenant_id    TEXT    NOT NULL,
  owner_oid          TEXT    NOT NULL,
  name               TEXT    NOT NULL,
  notes              TEXT,
  profile_kind       TEXT    NOT NULL,
  profile_json       TEXT    NOT NULL,
  switch_json        TEXT    NOT NULL,
  plate_json         TEXT    NOT NULL,
  fill_json          TEXT    NOT NULL,
  feet_json          TEXT,
  nameplate_json     TEXT,
  skipped_cells_json TEXT,
  case_clear_mm      REAL,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE INDEX idx_switch_trays_owner
  ON switch_tray_designs (owner_tenant_id, owner_oid, updated_at DESC)`,
]

export const TOOL_TRAY_STATEMENTS: readonly string[] = [
  `CREATE TABLE tool_tray_designs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_tenant_id   TEXT    NOT NULL,
  owner_oid         TEXT    NOT NULL,
  name              TEXT    NOT NULL,
  notes             TEXT,
  profile_kind      TEXT    NOT NULL,
  profile_json      TEXT    NOT NULL,
  height_mm         REAL    NOT NULL,
  layer_height_mm   REAL    NOT NULL,
  min_floor_mm      REAL    NOT NULL,
  pockets_json      TEXT    NOT NULL,
  pocket_count      INTEGER NOT NULL,
  feet_json         TEXT,
  underside_relief  TEXT,
  case_clear_mm     REAL,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE INDEX idx_tool_trays_owner
  ON tool_tray_designs (owner_tenant_id, owner_oid, updated_at DESC)`,
]

/**
 * X2D maintenance: when the printer was serviced, and how it is worked.
 *
 * Two tables, because the account is telling us two different kinds of thing.
 *
 *   `maintenance_profile`  one row per account -- when the printer entered
 *                          service, how hard it is worked, and how many rolls
 *                          have gone through the cutter. The tier and the wear
 *                          rate are what turn Bambu's tiered intervals into
 *                          actual dates, so they are settings, not history.
 *
 *   `maintenance_events`   one row per job done, append-only in spirit. Kept as
 *                          history rather than as a "last done" column on the
 *                          task, because a service record whose earlier entries
 *                          are overwritten by the latest one is not a record.
 *                          Due dates read the newest row per task; the rest is
 *                          the log you scroll back through.
 *
 * `task_key` is a key from lib/contracts/x2dMaintenance.ts. The database holds
 * it as an opaque string and the route is what proves it names a real task --
 * the same arrangement `filament_inventory.filament_key` already uses.
 */
export const X2D_MAINTENANCE_STATEMENTS: readonly string[] = [
  `CREATE TABLE maintenance_profile (
  owner_tenant_id TEXT    NOT NULL,
  owner_oid       TEXT    NOT NULL,
  commissioned_on TEXT    NOT NULL CHECK (commissioned_on LIKE '____-__-__'),
  usage_tier      TEXT    NOT NULL CHECK (usage_tier IN ('high', 'regular', 'low')),
  filament_wear   TEXT    NOT NULL CHECK (filament_wear IN ('standard', 'abrasive')),
  rolls_used      INTEGER NOT NULL DEFAULT 0 CHECK (rolls_used >= 0),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (owner_tenant_id, owner_oid)
)`,
  `CREATE TABLE maintenance_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_tenant_id TEXT    NOT NULL,
  owner_oid       TEXT    NOT NULL,
  task_key        TEXT    NOT NULL,
  performed_on    TEXT    NOT NULL CHECK (performed_on LIKE '____-__-__'),
  note            TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
  // Due-date reads ask for the newest event of one task; the log asks for the
  // newest events of every task. Both are this index, read in the same order.
  `CREATE INDEX idx_maintenance_events_owner
  ON maintenance_events (owner_tenant_id, owner_oid, task_key, performed_on DESC, id DESC)`,
]

/** Tables ShapePilot owns and reconciles. Order is the reconciliation order. */
export const OWNED_LEGACY_TABLES = [
  'keycap_tray_designs',
  'keycap_tray_pockets',
  'keycap_pocket_library',
] as const

export type OwnedLegacyTable = (typeof OWNED_LEGACY_TABLES)[number]

/**
 * The model Library: an index of the 3D print files on the owner's Mac, moved
 * here from Workshop.
 *
 * The files never reach this server. The organizer on the Mac
 * (tools/library-scanner) syncs one row per model folder -- keyed by the id in
 * that folder's model.json, so a rename or move in Finder keeps its row -- plus
 * the files' metadata. Thumbnails are bytes in the asset store, like every
 * other non-authoritative picture here; `library_thumbs` only records which
 * hashes an account has, so the organizer can skip uploading them again.
 *
 * Models are never deleted, only marked `missing`, so nothing points at a
 * model with a foreign key that would have to null an owner column: prints and
 * collection rows name the model by id, and the reads join on owner + id.
 *
 * `bambu_hub_url` replaces Workshop's foreign key into its own Bambu Hub table.
 * That table stayed behind in Workshop, so the link is a plain URL to the
 * project page there.
 */
export const LIBRARY_STATEMENTS: readonly string[] = [
  `CREATE TABLE library_models (
  owner_tenant_id TEXT    NOT NULL,
  owner_oid       TEXT    NOT NULL,
  id              TEXT    NOT NULL CHECK (length(id) BETWEEN 8 AND 64),
  title           TEXT    NOT NULL,
  category        TEXT    NOT NULL DEFAULT '_Inbox',
  folder          TEXT,
  status          TEXT    NOT NULL DEFAULT 'inbox'
                  CHECK (status IN ('inbox', 'want', 'queued', 'printed', 'failed', 'skip')),
  tags_json       TEXT    NOT NULL DEFAULT '[]',
  notes           TEXT    NOT NULL DEFAULT '',
  favorite        INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  designer        TEXT,
  license         TEXT,
  description     TEXT,
  source_site     TEXT,
  source_url      TEXT,
  source_model_id TEXT,
  bambu_hub_url   TEXT    CHECK (bambu_hub_url IS NULL OR length(bambu_hub_url) <= 2000),
  thumb_hash      TEXT,
  gallery_json    TEXT    NOT NULL DEFAULT '[]',
  formats_json    TEXT    NOT NULL DEFAULT '[]',
  file_count      INTEGER NOT NULL DEFAULT 0,
  total_bytes     INTEGER NOT NULL DEFAULT 0,
  plate_count     INTEGER NOT NULL DEFAULT 0,
  printer         TEXT,
  filaments_json  TEXT    NOT NULL DEFAULT '[]',
  est_seconds     REAL,
  est_grams       REAL,
  is_sliced       INTEGER NOT NULL DEFAULT 0 CHECK (is_sliced IN (0, 1)),
  bbox_json       TEXT,
  state           TEXT    NOT NULL DEFAULT 'present' CHECK (state IN ('present', 'missing')),
  edit_version    INTEGER NOT NULL DEFAULT 0,
  disk_version    INTEGER NOT NULL DEFAULT 0,
  disk_created_at TEXT,
  first_seen_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (owner_tenant_id, owner_oid, id)
)`,
  `CREATE INDEX idx_library_models_status
  ON library_models (owner_tenant_id, owner_oid, state, status)`,
  `CREATE TABLE library_files (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_tenant_id TEXT    NOT NULL,
  owner_oid       TEXT    NOT NULL,
  model_id        TEXT    NOT NULL,
  rel_path        TEXT    NOT NULL,
  filename        TEXT    NOT NULL,
  kind            TEXT    NOT NULL CHECK (kind IN ('stl', '3mf', 'obj', 'step', 'other')),
  size            INTEGER NOT NULL DEFAULT 0,
  sha256          TEXT    NOT NULL,
  geom_hash       TEXT,
  mtime           TEXT,
  triangles       INTEGER,
  bbox_json       TEXT,
  is_sliced       INTEGER NOT NULL DEFAULT 0 CHECK (is_sliced IN (0, 1)),
  printer         TEXT,
  seconds         REAL,
  grams           REAL,
  plates_json     TEXT    NOT NULL DEFAULT '[]',
  profile_title   TEXT,
  filaments_json  TEXT    NOT NULL DEFAULT '[]',
  generator       TEXT,
  thumb_hash      TEXT,
  FOREIGN KEY (owner_tenant_id, owner_oid, model_id)
    REFERENCES library_models (owner_tenant_id, owner_oid, id) ON DELETE CASCADE
)`,
  `CREATE UNIQUE INDEX idx_library_files_path
  ON library_files (owner_tenant_id, owner_oid, rel_path)`,
  `CREATE INDEX idx_library_files_model
  ON library_files (owner_tenant_id, owner_oid, model_id)`,
  `CREATE INDEX idx_library_files_geom
  ON library_files (owner_tenant_id, owner_oid, geom_hash) WHERE geom_hash IS NOT NULL`,
  `CREATE TABLE library_thumbs (
  owner_tenant_id TEXT NOT NULL,
  owner_oid       TEXT NOT NULL,
  hash            TEXT NOT NULL CHECK (length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*'),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (owner_tenant_id, owner_oid, hash)
)`,
  // A print is either logged by hand or copied out of the household printer's
  // job ledger (EL-ement Statistics); `job_key` is that ledger's
  // "<connection>:<job>" and keeps a re-import from duplicating it.
  `CREATE TABLE library_prints (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_tenant_id TEXT    NOT NULL,
  owner_oid       TEXT    NOT NULL,
  model_id        TEXT,
  source          TEXT    NOT NULL CHECK (source IN ('manual', 'bambu')),
  job_key         TEXT,
  title           TEXT,
  result          TEXT    NOT NULL DEFAULT 'completed'
                  CHECK (result IN ('completed', 'failed', 'active', 'unknown')),
  started_at      TEXT,
  ended_at        TEXT,
  seconds         REAL,
  grams           REAL,
  materials_json  TEXT    NOT NULL DEFAULT '[]',
  notes           TEXT    NOT NULL DEFAULT '',
  match_state     TEXT    NOT NULL DEFAULT 'manual'
                  CHECK (match_state IN ('manual', 'auto', 'confirmed', 'suggested', 'unmatched', 'rejected')),
  match_score     REAL,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((source = 'bambu') = (job_key IS NOT NULL))
)`,
  `CREATE UNIQUE INDEX idx_library_prints_job
  ON library_prints (owner_tenant_id, owner_oid, job_key) WHERE job_key IS NOT NULL`,
  `CREATE INDEX idx_library_prints_model
  ON library_prints (owner_tenant_id, owner_oid, model_id)`,
  `CREATE TABLE library_devices (
  id              TEXT PRIMARY KEY,
  owner_tenant_id TEXT NOT NULL,
  owner_oid       TEXT NOT NULL,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  token_hash      TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at    TEXT,
  revoked_at      TEXT,
  FOREIGN KEY (owner_tenant_id, owner_oid) REFERENCES app_memberships (tenant_id, oid)
)`,
  `CREATE TABLE library_collections (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_tenant_id TEXT NOT NULL,
  owner_oid       TEXT NOT NULL,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  kind            TEXT NOT NULL CHECK (kind IN ('manual', 'smart')),
  query_json      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`,
  `CREATE UNIQUE INDEX idx_library_collections_name
  ON library_collections (owner_tenant_id, owner_oid, name COLLATE NOCASE)`,
  `CREATE TABLE library_collection_models (
  collection_id INTEGER NOT NULL REFERENCES library_collections (id) ON DELETE CASCADE,
  model_id      TEXT    NOT NULL,
  added_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (collection_id, model_id)
)`,
  // The organizer's last plan and change log, and the print-history cursor.
  `CREATE TABLE library_state (
  owner_tenant_id TEXT NOT NULL,
  owner_oid       TEXT NOT NULL,
  key             TEXT NOT NULL,
  value           TEXT NOT NULL,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (owner_tenant_id, owner_oid, key)
)`,
]
