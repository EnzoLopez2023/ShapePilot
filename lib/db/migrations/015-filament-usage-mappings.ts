import { FILAMENT_USAGE_MAPPING_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * `filament_usage_mappings` -- links from what a print reported to a catalogue
 * colour, or to "don't track".
 *
 * A new table and nothing else, so it is additive: every account starts with no
 * links, which leaves usage matched automatically where it can be and listed as
 * unmatched where it cannot.
 */
export const migration015: Migration = {
  id: '015-filament-usage-mappings',
  name: 'filament usage mappings',
  statements: FILAMENT_USAGE_MAPPING_STATEMENTS,
}
