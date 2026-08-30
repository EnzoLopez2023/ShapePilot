import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  MIGRATIONS,
  codeLedger,
  migrate,
  readAppliedMigrations,
} from '../lib/db/migrate.ts'
import { applyConnectionPragmas } from '../lib/db/connection.ts'

/**
 * The migration lineage this release ships.
 *
 * Updating this list is a deliberate acknowledgement, not a formality. Once a
 * new migration has applied in production, `migrate()` refuses to start any
 * image whose ledger is shorter (SCHEMA_AHEAD_OF_CODE), so CI's automatic
 * image rollback no longer has a working previous image to fall back to. The
 * checks below still prove the *data* stays readable by a prior release's
 * queries -- which is what makes a manual, deliberate rollback recoverable --
 * but the automatic path must be treated as unavailable for that deploy.
 *
 * The runbook -- take a snapshot first, and how to recover deliberately if
 * verification fails -- is "Deploys that add a migration" in docs/DEPLOYMENT.md.
 */
const ROLLBACK_COMPATIBLE_LEDGER = [
  {
    ordinal: 0,
    id: '001-initial',
    name: 'initial schema',
    checksum: '3016a633c7fff84a0220eb5f168610c4be05f5f2be4ddc4c4f75f12d86818d94',
  },
  {
    ordinal: 1,
    id: '002-app-identity',
    name: 'app identity markers',
    checksum: '8c544e56627040b6a2cd397454b4b5611e89f49b50345342db29364271e5114b',
  },
  {
    ordinal: 2,
    id: '003-design-documents',
    name: 'design documents',
    checksum: '4b7e7414f4d6db453f12e001b62f7a1dafec6fb9702078928453650399ff94ba',
  },
  {
    ordinal: 3,
    id: '004-design-assets',
    name: 'design assets',
    checksum: '9c0980e90616e1feb6472810d01e372d48216c5935b33a73617e88241621dc41',
  },
] as const

const REQUIRED_TABLES = [
  'app_identity',
  'app_memberships',
  'app_settings',
  'audit_events',
  'design_assets',
  'design_documents',
  'keycap_pocket_library',
  'keycap_tray_designs',
  'keycap_tray_pockets',
  'legacy_import_rows',
  'legacy_import_runs',
  'schema_migrations',
] as const

interface Arguments {
  profile: 'sqlite-one-worker'
  initial: boolean
}

function parseArguments(args: string[]): Arguments {
  let profile: string | undefined
  let initial = false
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--initial') {
      if (initial) throw new Error('--initial may be supplied only once')
      initial = true
      continue
    }
    if (flag !== '--profile' || profile !== undefined || args[index + 1] == null) {
      throw new Error(`invalid argument near ${flag ?? '<end>'}`)
    }
    profile = args[index + 1]
    index += 1
  }
  if (profile !== 'sqlite-one-worker') {
    throw new Error('ShapePilot requires --profile sqlite-one-worker')
  }
  return { profile, initial }
}

function seedRepresentativeData(database: Database.Database): number {
  database.prepare(`
    INSERT INTO app_memberships (tenant_id, oid, role, display_name, email)
    VALUES (?, ?, 'admin', 'Migration Fixture', 'fixture@example.invalid')
  `).run('52188f12-db6b-46c6-88ff-08c802f0ed3b', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  const design = database.prepare(`
    INSERT INTO keycap_tray_designs (
      owner_tenant_id, owner_oid, name, profile_kind, profile_json, sizing_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    '52188f12-db6b-46c6-88ff-08c802f0ed3b',
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    'Compatibility fixture',
    'rect',
    '{"widthMm":120,"heightMm":80,"cornerMm":4}',
    '{"unit":"mm"}',
  )
  database.prepare(`
    INSERT INTO keycap_tray_pockets (
      design_id, units, height_units, x_mm, y_mm, shape, sort_order
    ) VALUES (?, 1, 1, 12, 16, 'mx', 0)
  `).run(design.lastInsertRowid)
  database.prepare(`
    INSERT INTO keycap_pocket_library (
      owner_tenant_id, owner_oid, name, units, width_mm, height_mm
    ) VALUES (?, ?, 'Fixture pocket', 1, 14, 14)
  `).run('52188f12-db6b-46c6-88ff-08c802f0ed3b', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  return Number(design.lastInsertRowid)
}

function assertCandidate(database: Database.Database, designId: number): void {
  assert.equal(database.pragma('integrity_check', { simple: true }), 'ok')
  assert.deepEqual(database.pragma('foreign_key_check'), [])
  assert.equal(
    String(database.pragma('journal_mode', { simple: true })).toLowerCase(),
    'delete',
  )
  const tables = new Set(
    (database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `).all() as { name: string }[]).map(({ name }) => name),
  )
  for (const table of REQUIRED_TABLES) {
    assert.equal(tables.has(table), true, `candidate schema is missing ${table}`)
  }

  database.prepare(`
    INSERT INTO keycap_tray_pockets (
      design_id, units, height_units, x_mm, y_mm, shape, sort_order
    ) VALUES (?, 2, 1, 24, 16, 'mx', 1)
  `).run(designId)
}

function assertPriorReleaseReads(database: Database.Database, designId: number): void {
  database.pragma('query_only = ON')
  const design = database.prepare(`
    SELECT id, owner_tenant_id, owner_oid, name, profile_kind, profile_json,
           sizing_json, floor_mm, depth_mm, engrave_mm, created_at, updated_at
    FROM keycap_tray_designs WHERE id = ?
  `).get(designId) as { name: string } | undefined
  const pockets = database.prepare(`
    SELECT id, design_id, units, height_units, x_mm, y_mm, rotation_deg,
           is_through, label, label_mode, depth_mm, width_mm, height_mm,
           corner_mm, sort_order, mirror_x, shape
    FROM keycap_tray_pockets WHERE design_id = ? ORDER BY sort_order, id
  `).all(designId)
  assert.equal(design?.name, 'Compatibility fixture')
  assert.equal(pockets.length, 2)
}

export async function runMigrationCheck(options: Arguments): Promise<Record<string, unknown>> {
  assert.deepEqual(
    codeLedger(),
    ROLLBACK_COMPATIBLE_LEDGER,
    'migration lineage changed; automatic image rollback needs a new compatibility fixture',
  )

  const root = await mkdtemp(join(tmpdir(), 'shapepilot-migration-'))
  const path = join(root, 'previous-release.db')
  let database: Database.Database | null = null
  try {
    database = new Database(path)
    applyConnectionPragmas(database, 2_000, path)
    migrate(database, MIGRATIONS)
    const designId = seedRepresentativeData(database)

    database.transaction(() => migrate(database as Database.Database, MIGRATIONS))()
    assertCandidate(database, designId)
    assertPriorReleaseReads(database, designId)

    return {
      status: 'ok',
      profile: options.profile,
      initial: options.initial,
      priorReleaseCompatible: true,
      migrations: readAppliedMigrations(database).map(({ id, checksum }) => ({ id, checksum })),
      requiredTables: REQUIRED_TABLES,
    }
  } finally {
    database?.close()
    await rm(root, { recursive: true, force: true })
  }
}

try {
  const result = await runMigrationCheck(parseArguments(process.argv.slice(2)))
  console.log(JSON.stringify(result))
} catch (error) {
  console.error(
    `Migration compatibility check failed: ${error instanceof Error ? error.message : error}`,
  )
  process.exitCode = 1
}
