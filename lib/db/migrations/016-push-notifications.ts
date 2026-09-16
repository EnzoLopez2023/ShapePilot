import { PUSH_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * `push_subscriptions` and `filament_reorder_alerts` -- reorder reminders
 * delivered by Web Push.
 *
 * Two new tables and nothing else, so it is additive: no account has a
 * subscription until a browser turns reminders on, and none has been told
 * anything yet.
 */
export const migration016: Migration = {
  id: '016-push-notifications',
  name: 'push notifications',
  statements: PUSH_STATEMENTS,
}
