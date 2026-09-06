import { FILAMENT_INVENTORY_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * `filament_inventory` -- which filaments an account owns.
 *
 * A new table rather than a column, and the first one that is neither a design
 * nor a document: the inventory says what this workbench can print in today,
 * which is a fact about the account and not about any one tray.
 *
 * Additive. Every account that exists before this migration reads back as
 * owning nothing, which is the correct starting state for all of them.
 */
export const migration009: Migration = {
  id: '009-filament-inventory',
  name: 'filament inventory',
  statements: FILAMENT_INVENTORY_STATEMENTS,
}
