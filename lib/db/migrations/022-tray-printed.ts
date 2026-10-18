import { TRAY_PRINTED_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * `printed_at` on `keycap_tray_designs` -- the manual "I printed this" mark.
 *
 * Additive and nullable, so every existing tray reads back unmarked.
 */
export const migration022: Migration = {
  id: '022-tray-printed',
  name: 'keycap tray printed mark',
  statements: TRAY_PRINTED_STATEMENTS,
}
