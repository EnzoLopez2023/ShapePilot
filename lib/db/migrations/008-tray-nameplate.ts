import { NAMEPLATE_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * `nameplate_json` on `keycap_tray_designs` -- the raised tray-name text that
 * sits proud of the floor.
 *
 * Additive and nullable, so every tray that exists before this migration reads
 * back exactly as it did: no nameplate.
 */
export const migration008: Migration = {
  id: '008-tray-nameplate',
  name: 'keycap tray nameplate',
  statements: NAMEPLATE_STATEMENTS,
}
