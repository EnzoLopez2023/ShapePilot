import { X2D_MAINTENANCE_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * `maintenance_profile` and `maintenance_events` -- when the X2D was serviced.
 *
 * Owner-scoped like the filament inventory, and for the same reason: a service
 * record is a fact about the printer on this account's bench, not about any one
 * tray or document.
 *
 * Additive, and empty for every account that existed before it. An account with
 * no profile row has not told us when its printer entered service, which the
 * page asks for before it schedules anything -- an absent profile is a question
 * to ask, never a date to guess.
 */
export const migration013: Migration = {
  id: '013-x2d-maintenance',
  name: 'X2D maintenance calendar',
  statements: X2D_MAINTENANCE_STATEMENTS,
}
