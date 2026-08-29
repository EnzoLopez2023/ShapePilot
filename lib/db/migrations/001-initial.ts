import { INITIAL_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * The one migration in the shipped ledger. Migrations are append-only: this
 * file is never edited again once it has been applied anywhere, because its
 * checksum is what proves an existing database matches the shipped schema.
 */
export const migration001: Migration = {
  id: '001-initial',
  name: 'initial schema',
  statements: INITIAL_STATEMENTS,
}
