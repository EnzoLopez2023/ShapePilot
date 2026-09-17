import { FILAMENT_PRICE_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * `filament_prices` -- what a kilogram of each line costs this account.
 *
 * One new table, so it is additive: every account starts with nothing priced,
 * and an unpriced line simply has no cost to show.
 */
export const migration017: Migration = {
  id: '017-filament-prices',
  name: 'filament prices',
  statements: FILAMENT_PRICE_STATEMENTS,
}
