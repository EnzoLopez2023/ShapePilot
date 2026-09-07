import { SWITCH_TRAY_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * `switch_tray_designs` -- a plate that holds mechanical keyboard switches.
 *
 * A new table and, unlike the keycap tray, no companion row table: a switch
 * tray's cells are all identical and are generated from its pitch, margin and
 * outline rather than placed one by one, so what is stored is the parameters
 * that generate them. A tray holding 130 switches is one row.
 *
 * Additive and independent -- nothing existing reads or writes this table, and
 * every account that exists before this migration reads back as owning no
 * switch trays.
 */
export const migration010: Migration = {
  id: '010-switch-trays',
  name: 'switch trays',
  statements: SWITCH_TRAY_STATEMENTS,
}
