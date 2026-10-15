import Database from 'better-sqlite3'
import { expect, test } from 'vitest'
import { MIGRATIONS, migrate, MigrationError } from '../../lib/db/migrate.ts'

// The ticks and line prices this replaces are not dropped or rewritten: an
// account's old inventory survives the migration exactly, just unread.
test('019 is additive and leaves the old ticks and prices exactly as they were', () => {
  const db = new Database(':memory:')
  try {
    db.pragma('foreign_keys = ON')
    migrate(db, MIGRATIONS.slice(0, 18))
    db.prepare(`INSERT INTO filament_inventory (owner_tenant_id, owner_oid, filament_key, variant, quantity)
      VALUES ('t', 'o', 'bambu-lab/pla/basic/jade-white-10100', 'spool', 3)`).run()
    db.prepare(`INSERT INTO filament_prices (owner_tenant_id, owner_oid, line_id, price_per_kg, currency)
      VALUES ('t', 'o', 'bambu-lab/pla/basic', 20, 'USD')`).run()
    const previous = db.prepare("SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()

    expect(MIGRATIONS[18].id).toBe('019-filament-orders')
    expect(migrate(db, MIGRATIONS.slice(0, 19)).applied).toEqual(['019-filament-orders'])
    const after = db.prepare(`SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'
      AND name NOT LIKE 'filament_order%' AND name NOT LIKE 'idx_filament_orders%'
      AND name <> 'filament_roll_adjustments' ORDER BY name`).all()
    expect(after).toEqual(previous)
    expect(db.prepare('SELECT quantity FROM filament_inventory').get()).toEqual({ quantity: 3 })
    expect(db.prepare('SELECT price_per_kg FROM filament_prices').get()).toEqual({ price_per_kg: 20 })
    expect(db.prepare('SELECT count(*) AS n FROM filament_orders').get()).toEqual({ n: 0 })
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(migrate(db, MIGRATIONS.slice(0, 19)).applied).toEqual([])
    expect(() => migrate(db, MIGRATIONS.slice(0, 18))).toThrow(MigrationError)
  } finally { db.close() }
})
