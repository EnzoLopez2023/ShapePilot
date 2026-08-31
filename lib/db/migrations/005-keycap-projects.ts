import { KEYCAP_PROJECT_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * Keycap projects, their set inventory, and their photos -- plus the nullable
 * `project_id` that links a tray design to one.
 *
 * Appended rather than folded into 001: migrations are append-only and
 * checksummed, and amending an applied one is a hard startup failure for any
 * database that already has it. The ALTER on `keycap_tray_designs` is the
 * reason this migration touches a pinned legacy table at all; the column is
 * additive and defaults to NULL, so every row imported from Hearth reads back
 * exactly as it did before.
 */
export const migration005: Migration = {
  id: '005-keycap-projects',
  name: 'keycap projects',
  statements: KEYCAP_PROJECT_STATEMENTS,
}
