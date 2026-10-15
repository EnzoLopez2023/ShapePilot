import Database from 'better-sqlite3'
import { expect, test } from 'vitest'
import { MIGRATIONS, migrate, MigrationError } from '../../lib/db/migrate.ts'

// The Library arrives empty and touches nothing that was already there.
test('020 is additive and only creates the library tables', () => {
  const db = new Database(':memory:')
  try {
    db.pragma('foreign_keys = ON')
    migrate(db, MIGRATIONS.slice(0, 19))
    const previous = db.prepare("SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()

    expect(MIGRATIONS[19].id).toBe('020-library')
    expect(migrate(db, MIGRATIONS.slice(0, 20)).applied).toEqual(['020-library'])
    const after = db.prepare(`SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'
      AND name NOT LIKE 'library_%' AND name NOT LIKE 'idx_library_%' ORDER BY name`).all()
    expect(after).toEqual(previous)
    const created = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'library_%' ORDER BY name")
      .all().map(row => (row as { name: string }).name)
    expect(created).toEqual([
      'library_collection_models', 'library_collections', 'library_devices', 'library_files',
      'library_models', 'library_prints', 'library_state', 'library_thumbs',
    ])
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(() => migrate(db, MIGRATIONS.slice(0, 19))).toThrow(MigrationError)
  } finally { db.close() }
})
