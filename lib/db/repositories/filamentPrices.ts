// Filament price repository.
//
// Prices are replaced wholesale, like the inventory beside them: the page holds
// every priced line, sends every priced line, and a half-applied price list is
// never a state the database can be in. A line with no row is unpriced, which
// is a real answer -- nothing here invents a price to make a cost figure
// possible.
import type { SqliteDatabase } from '../connection.ts'
import type { FilamentPrice, FilamentPriceRepository, Owner } from './contracts.ts'

interface PriceRow {
  line_id: string
  price_per_kg: number
  currency: string
}

const rowToPrice = (row: PriceRow): FilamentPrice => ({
  line: row.line_id,
  pricePerKg: row.price_per_kg,
  currency: row.currency,
})

export function createFilamentPriceRepository(db: SqliteDatabase): FilamentPriceRepository {
  const selectPrices = db.prepare<[string, string], PriceRow>(`
    SELECT line_id, price_per_kg, currency
      FROM filament_prices
     WHERE owner_tenant_id = ? AND owner_oid = ?
     ORDER BY line_id`)

  const deletePrices = db.prepare(
    'DELETE FROM filament_prices WHERE owner_tenant_id = ? AND owner_oid = ?')

  const insertPrice = db.prepare(`
    INSERT INTO filament_prices (owner_tenant_id, owner_oid, line_id, price_per_kg, currency)
    VALUES (?, ?, ?, ?, ?)`)

  const replaceTx = db.transaction((owner: Owner, prices: readonly FilamentPrice[]) => {
    deletePrices.run(owner.tenantId, owner.oid)
    for (const price of prices) {
      insertPrice.run(owner.tenantId, owner.oid, price.line, price.pricePerKg, price.currency)
    }
  })

  return {
    async list(owner) {
      return selectPrices.all(owner.tenantId, owner.oid).map(rowToPrice)
    },

    async replace(owner, prices) {
      replaceTx(owner, prices)
      // Read back rather than echoing the input, as the inventory does.
      return selectPrices.all(owner.tenantId, owner.oid).map(rowToPrice)
    },
  }
}
