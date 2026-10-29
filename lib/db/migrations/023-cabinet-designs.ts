import { CABINET_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * Named cabinets from the cabinet designer, previously kept only in the browser.
 *
 * Additive and independent: one new table nothing existing reads. Cabinets
 * saved in a browser are not carried over; the designer offers to upload them.
 */
export const migration023: Migration = {
  id: '023-cabinet-designs',
  name: 'cabinet designs',
  statements: CABINET_STATEMENTS,
}
