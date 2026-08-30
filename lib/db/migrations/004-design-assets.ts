import { DESIGN_ASSET_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * Metadata for imported design assets.
 *
 * Appended rather than folded into 003: migrations are append-only and
 * checksummed, and amending an applied one is a hard startup failure for any
 * database that already has it.
 */
export const migration004: Migration = {
  id: '004-design-assets',
  name: 'design assets',
  statements: DESIGN_ASSET_STATEMENTS,
}
