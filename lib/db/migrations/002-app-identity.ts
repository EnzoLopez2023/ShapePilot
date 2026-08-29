import { APP_IDENTITY_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * Durable app and schema-format markers.
 *
 * Appended rather than folded into 001: migrations are append-only, and 001's
 * checksum is what proves an already-migrated database matches this build.
 */
export const migration002: Migration = {
  id: '002-app-identity',
  name: 'app identity markers',
  statements: APP_IDENTITY_STATEMENTS,
}
