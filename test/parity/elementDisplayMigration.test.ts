import Database from 'better-sqlite3'
import { expect, test } from 'vitest'
import { MIGRATIONS, migrate, MigrationError, migrationChecksum } from '../../lib/db/migrate.ts'

test('018 is additive, preserves 017 rows/schema and keeps old-image rollback fail-closed', () => {
  const db = new Database(':memory:')
  try {
    db.pragma('foreign_keys = ON')
    migrate(db, MIGRATIONS.slice(0, 17))
    db.prepare(`INSERT INTO app_memberships (tenant_id, oid, role) VALUES ('synthetic-tenant', 'synthetic-owner', 'admin')`).run()
    const previous = db.prepare("SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()
    expect(migrationChecksum(MIGRATIONS[17])).toBe('f44fc7362cb2bc0bf71af82c2b8600cf710ae7113c82002cd7f7be92781de156')
    expect(migrate(db).applied).toEqual(['018-element-displays'])
    const after = db.prepare("SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'element_displays%' ORDER BY name").all()
    expect(after).toEqual(previous)
    expect(db.prepare('SELECT oid FROM app_memberships').get()).toEqual({ oid: 'synthetic-owner' })
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(migrate(db).applied).toEqual([])
    expect(() => migrate(db, MIGRATIONS.slice(0, 17))).toThrow(MigrationError)
  } finally { db.close() }
})
