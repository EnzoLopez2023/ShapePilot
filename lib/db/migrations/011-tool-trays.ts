import { TOOL_TRAY_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * `tool_tray_designs` -- a tray of pockets for tools, each pocket its own shape
 * and its own depth.
 *
 * One table, and the pockets live in a JSON blob rather than a companion row
 * table as the keycap tray's do. A tool pocket is a nested thing -- an ordered
 * list of extruded steps, each with its own footprint, and eventually a traced
 * outline -- and nothing will ever query into one. Keeping it a blob makes
 * create and update a single statement with no transaction, the way the switch
 * tray works.
 *
 * `pocket_count` is denormalised so the list endpoint never parses the blob.
 * The list is the hot path and a blob carrying traced outlines is not something
 * to parse just to say "12 pockets".
 *
 * Additive and independent: nothing existing reads or writes this table, and
 * every account that predates this migration reads back as owning no tool
 * trays.
 */
export const migration011: Migration = {
  id: '011-tool-trays',
  name: 'tool trays',
  statements: TOOL_TRAY_STATEMENTS,
}
