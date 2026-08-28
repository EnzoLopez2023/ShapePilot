// Synthetic legacy fixtures.
//
// Every fixture is generated here, at test time, from the pinned Hearth DDL.
// Nothing about the real production database is checked in, and no test needs
// the operator's backup to be present.
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { TEST_ROOT } from './server.ts'
import { OWNED_LEGACY_TABLES } from '../../lib/db/schema.ts'
import { exportLegacyBundle, sha256File } from '../../lib/legacy/exportLegacy.ts'
import type { ExportBundle, SourceEvidence } from '../../lib/legacy/manifest.ts'
import {
  PRODUCT_CANONICAL_ALGORITHM, TABLE_CANONICAL_ALGORITHM,
  canonicalTableHashFromDatabase, primaryKeyColumns, productCanonicalHash,
} from '../../lib/legacy/canonicalTable.ts'
import type { ApprovedSource, ApprovedTable } from '../../lib/legacy/approvedSource.ts'
import { validateApprovedSource } from '../../lib/legacy/approvedSource.ts'

/** Verbatim from Hearth commit f0b05fc1dbf53e8aa26c215d8e858894a2793871. */
export const LEGACY_DDL = [
  `CREATE TABLE keycap_tray_designs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  notes         TEXT,
  profile_kind  TEXT    NOT NULL,
  profile_json  TEXT    NOT NULL,
  sizing_json   TEXT    NOT NULL,
  floor_mm      REAL    NOT NULL DEFAULT 2.4,
  depth_mm      REAL    NOT NULL DEFAULT 10.0,
  engrave_mm    REAL    NOT NULL DEFAULT 0.4,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
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
  sort_order    INTEGER NOT NULL DEFAULT 0
, mirror_x INTEGER NOT NULL DEFAULT 0, shape TEXT)`,
  `CREATE INDEX idx_keycap_pockets_design
  ON keycap_tray_pockets (design_id, sort_order)`,
  `CREATE TABLE keycap_pocket_library (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  units       REAL    NOT NULL DEFAULT 1,
  width_mm    REAL,
  height_mm   REAL,
  corner_mm   REAL,
  notes       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
]

export type FixtureKind =
  | 'valid'
  | 'unicode-nulls'
  | 'duplicate-library'
  | 'orphan-pocket'
  | 'bad-json'
  | 'empty'

export interface LegacyFixture {
  path: string
  cleanup(): void
}

/**
 * Build a synthetic legacy database. `orphan-pocket` disables foreign keys for
 * the one insert that needs to be broken, which is exactly the corruption an
 * importer must refuse.
 */
export function createLegacyFixture(kind: FixtureKind = 'valid'): LegacyFixture {
  mkdirSync(TEST_ROOT, { recursive: true })
  const path = join(TEST_ROOT, `legacy-${kind}-${randomUUID()}.db`)
  const db = new Database(path)
  db.pragma('journal_mode = DELETE')
  for (const statement of LEGACY_DDL) {
    // A hand-edited or partially restored artifact can carry a library table
    // without the pinned UNIQUE(name); that is exactly what the duplicate
    // fixture has to reproduce, so the constraint is omitted up front rather
    // than dropped afterwards (SQLite refuses to drop an implicit index).
    if (kind === 'duplicate-library' && statement.includes('keycap_pocket_library')) {
      db.exec(statement.replace('TEXT    NOT NULL UNIQUE', 'TEXT    NOT NULL'))
      continue
    }
    db.exec(statement)
  }

  if (kind !== 'empty') {
    const design = db.prepare(`
      INSERT INTO keycap_tray_designs
        (id, name, notes, profile_kind, profile_json, sizing_json, floor_mm, depth_mm,
         engrave_mm, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const pocket = db.prepare(`
      INSERT INTO keycap_tray_pockets
        (id, design_id, units, height_units, x_mm, y_mm, rotation_deg, is_through, label,
         label_mode, depth_mm, width_mm, height_mm, corner_mm, sort_order, mirror_x, shape)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const library = db.prepare(`
      INSERT INTO keycap_pocket_library
        (id, name, units, width_mm, height_mm, corner_mm, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)

    const sizing = '{"pitch":19.05,"widthOffset":-0.45,"height":18.6,"cornerRadius":2,"cornerSegments":16}'

    design.run(1, 'Test Tray', null, 'preset', '{"id":"systainer-s76-notched"}', sizing,
      2.4, 10.0, 0.4, '2026-08-25 13:21:28', '2026-08-25 13:26:11')
    design.run(2, 'Test Tray 1', null, 'preset', '{"id":"systainer-s76-notched"}', sizing,
      2.4, 10.0, 0.4, '2026-08-27 00:07:24', '2026-08-27 00:07:24')

    // Nulls, a boolean integer, a fractional unit count and explicit overrides.
    pocket.run(7, 1, 1.0, 1.0, 114.0, 14.0, 0, 1, '1u', 'guide', null, null, null, null, 0, 0, null)
    pocket.run(8, 1, 4.0, 1.0, 87.0, 124.0, 0, 0, '4u', 'guide', null, null, null, null, 1, 0, null)
    pocket.run(13, 2, 1.5, 1.0, 54.0, 64.1417, 0, 0, 'ISO Enter', 'guide', null, null, null, null, 0, 0, null)
    pocket.run(17, 2, 0.5, 1.0, 51.5, 33.3, 0, 0, '14mm square', 'guide', null, 14.0, 14.0, 1.5, 1, 0, null)

    library.run(1, '14mm square', 0.5, 14.0, 14.0, 1.5,
      'Smaller than 1u -- fits small novelty or artisan caps.', '2026-08-25 22:16:56')
  }

  if (kind === 'unicode-nulls') {
    db.prepare(`
      INSERT INTO keycap_tray_designs
        (id, name, notes, profile_kind, profile_json, sizing_json, floor_mm, depth_mm,
         engrave_mm, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      3, 'Ünïcødé — 托盘 «test» 🎹', null, 'rect',
      '{"widthMm":248,"heightMm":156,"cornerRadiusMm":0}',
      '{"pitch":19.05,"widthOffset":-0.25,"height":18.8,"cornerRadius":1,"cornerSegments":16}',
      2.4, 10.0, 0.4, '2026-08-25 13:21:28', '2026-08-25 13:26:11')
    db.prepare(`
      INSERT INTO keycap_pocket_library
        (id, name, units, width_mm, height_mm, corner_mm, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      2, 'Ünïcødé pocket ✓', 1.25, null, null, null, null, '2026-08-25 22:16:57')
  }

  if (kind === 'duplicate-library') {
    db.prepare(`
      INSERT INTO keycap_pocket_library (id, name, units, created_at)
      VALUES (?, ?, ?, ?)`).run(2, '14mm square', 0.5, '2026-08-25 22:16:58')
  }

  if (kind === 'orphan-pocket') {
    db.pragma('foreign_keys = OFF')
    db.prepare(`
      INSERT INTO keycap_tray_pockets
        (id, design_id, units, height_units, x_mm, y_mm, rotation_deg, is_through, label,
         label_mode, depth_mm, width_mm, height_mm, corner_mm, sort_order, mirror_x, shape)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      99, 4242, 1.0, 1.0, 5.0, 5.0, 0, 0, 'orphan', 'guide', null, null, null, null, 0, 0, null)
  }

  if (kind === 'bad-json') {
    db.prepare(`
      INSERT INTO keycap_tray_designs
        (id, name, notes, profile_kind, profile_json, sizing_json, floor_mm, depth_mm,
         engrave_mm, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      4, 'Broken', null, 'rect', '{not json', '{}', 2.4, 10.0, 0.4,
      '2026-08-25 13:21:28', '2026-08-25 13:26:11')
  }

  db.close()

  return {
    path,
    cleanup() {
      rmSync(path, { force: true })
      rmSync(`${path}-journal`, { force: true })
    },
  }
}

/** Write a byte-corrupt "SQLite" file that must never be opened successfully. */
export function createCorruptFixture(): LegacyFixture {
  mkdirSync(TEST_ROOT, { recursive: true })
  const path = join(TEST_ROOT, `legacy-corrupt-${randomUUID()}.db`)
  const buffer = Buffer.alloc(8192)
  buffer.write('SQLite format 3\0', 0, 'latin1')
  buffer.fill(0xab, 100)
  writeFileSync(path, buffer)
  return { path, cleanup() { rmSync(path, { force: true }) } }
}

export async function evidenceFor(
  path: string, overrides: Partial<SourceEvidence> = {},
): Promise<SourceEvidence> {
  return {
    repository: 'EnzoLopez2023/Hearth',
    commit: 'f0b05fc1dbf53e8aa26c215d8e858894a2793871',
    tree: '62cbd35861c511f7c17187c875d19ee6e353b80d',
    version: '2.13.2',
    build: 172,
    imageDigest: 'sha256:dc4df7e0f966be5b0608e71643d316cc5eba7590b8e56cec482583ab69443140',
    backupBundle: '20260828T053625317Z-1e0918fd4eea2be7',
    backupCreatedUtc: '2026-08-28T05:36:25.317Z',
    file: 'hearth.sqlite3',
    bytes: statSync(path).size,
    sha256: await sha256File(path),
    ...overrides,
  }
}

export async function bundleFor(
  fixture: LegacyFixture, evidenceOverrides: Partial<SourceEvidence> = {},
): Promise<ExportBundle> {
  return exportLegacyBundle({
    backupPath: fixture.path,
    source: await evidenceFor(fixture.path, evidenceOverrides),
    createdUtc: '2026-08-28T12:00:00.000Z',
  })
}

/**
 * The approved-source contract a coordinator would have recorded for a fixture.
 *
 * Derived the way the real one was: by reading the source database directly —
 * its CREATE statements, its declared columns and its canonical table hashes —
 * never from the export bundle the importer is about to be handed. A fixture
 * therefore has to survive exactly the same gate the production bundle does.
 */
export async function approvedSourceFor(
  fixture: LegacyFixture, overrides: Partial<SourceEvidence> = {},
): Promise<ApprovedSource> {
  const evidence = await evidenceFor(fixture.path, overrides)
  const db = new Database(fixture.path, { readonly: true, fileMustExist: true })
  let tables: ApprovedTable[]
  let sqliteSequence: ApprovedSource['sqliteSequence']
  try {
    tables = OWNED_LEGACY_TABLES.map((name): ApprovedTable => {
      const create = db.prepare<[string], { sql: string }>(
        "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name)
      const canonical = canonicalTableHashFromDatabase(db, name)
      return {
        name,
        rowCount: canonical.rowCount,
        createSqlSha256: createHash('sha256').update(create?.sql ?? '').digest('hex'),
        primaryKey: primaryKeyColumns(canonical.columns).map((column) => column.name),
        columns: canonical.columns,
        canonicalSha256: canonical.hash,
      }
    })
    const sourceSequences = new Map(
      (db.prepare('SELECT name, seq FROM sqlite_sequence').all() as {
        name: string
        seq: number
      }[]).map((row) => [row.name, Number(row.seq)]),
    )
    sqliteSequence = OWNED_LEGACY_TABLES.map((name) => ({
      name,
      seq: sourceSequences.get(name) ?? 0,
    }))
  } finally {
    db.close()
  }

  return validateApprovedSource({
    contract: 'shapepilot.approved-legacy-source.v1',
    contractVersion: 1,
    app: 'shapepilot',
    product: 'ShapePilot',
    status: 'approved',
    recordedUtc: '2026-08-28T12:00:00.000Z',
    evidence: { fixture: 'synthetic' },
    source: {
      repository: evidence.repository,
      commit: evidence.commit,
      tree: evidence.tree,
      version: evidence.version,
      build: evidence.build,
      imageDigest: evidence.imageDigest,
      workflowRunId: '0',
      backupBundle: evidence.backupBundle,
      backupCreatedUtc: evidence.backupCreatedUtc,
      bytes: evidence.bytes,
      sha256: evidence.sha256,
    },
    canonical: {
      tableAlgorithm: TABLE_CANONICAL_ALGORITHM,
      productAlgorithm: PRODUCT_CANONICAL_ALGORITHM,
      productCanonicalSha256: productCanonicalHash('ShapePilot', tables.map((table) => ({
        name: table.name,
        canonicalSha256: table.canonicalSha256,
        rowCount: table.rowCount,
      }))),
      totalRowCount: tables.reduce((total, table) => total + table.rowCount, 0),
    },
    sqliteSequence,
    tables,
  })
}

/** A fixture plus the approved contract that authorizes importing it. */
export async function approvedBundleFor(
  fixture: LegacyFixture, overrides: Partial<SourceEvidence> = {},
): Promise<{ bundle: ExportBundle; approved: ApprovedSource }> {
  return {
    bundle: await bundleFor(fixture, overrides),
    approved: await approvedSourceFor(fixture, overrides),
  }
}
