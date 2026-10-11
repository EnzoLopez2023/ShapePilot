import { FILAMENT_ORDER_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * `filament_orders`, `filament_order_lines`, `filament_roll_adjustments` --
 * what an account bought, which replaces the owned ticks as the inventory.
 *
 * Additive. The tick and line-price tables stay exactly as they were and are
 * simply no longer read, so nothing that was stored is lost; every account
 * starts with no orders, and so with an empty shelf until it logs some.
 */
export const migration019: Migration = {
  id: '019-filament-orders',
  name: 'filament orders',
  statements: FILAMENT_ORDER_STATEMENTS,
}
