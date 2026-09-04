import { CORNER_SPACER_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * `corner_spacers_json` on `keycap_tray_designs` -- the stacking posts a tray
 * carries so a tray above it clears the keycaps.
 *
 * Additive and nullable, so every row imported from Hearth (and every tray
 * created before this) reads back exactly as it did: no spacers.
 */
export const migration006: Migration = {
  id: '006-corner-spacers',
  name: 'keycap tray corner spacers',
  statements: CORNER_SPACER_STATEMENTS,
}
