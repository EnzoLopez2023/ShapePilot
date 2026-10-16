import { GRIDFINITY_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * Gridfinity bins, drawer baseplates and label lists.
 *
 * Additive and independent: three new tables nothing existing reads. Every
 * account starts with no designs; the Kreg pocket-screw label list is added
 * lazily the first time the owner opens the designer, not here.
 */
export const migration021: Migration = {
  id: '021-gridfinity',
  name: 'gridfinity',
  statements: GRIDFINITY_STATEMENTS,
}
