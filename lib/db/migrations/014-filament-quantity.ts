import { FILAMENT_QUANTITY_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * `quantity` on `filament_inventory` -- more than one spool of a colour.
 *
 * Additive, defaulting to 1, so every inventory that exists before this
 * migration reads back unchanged: each tick is one spool. An image one release
 * behind still reads the table (it never selects the new column) and still
 * writes it (its inserts take the default), so an automatic rollback loses
 * counts written since, never ticks.
 */
export const migration014: Migration = {
  id: '014-filament-quantity',
  name: 'filament quantity',
  statements: FILAMENT_QUANTITY_STATEMENTS,
}
