import { LOCATING_POST_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * `locating_posts_json` on `keycap_tray_pockets` -- the per-1u-slot posts that
 * hold several keycaps steady inside one shared long pocket.
 *
 * Additive and nullable, so every pocket that exists before this migration
 * reads back exactly as it did: no posts.
 */
export const migration007: Migration = {
  id: '007-locating-posts',
  name: 'keycap tray locating posts',
  statements: LOCATING_POST_STATEMENTS,
}
