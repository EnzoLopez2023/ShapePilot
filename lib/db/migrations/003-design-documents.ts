import { DESIGN_DOCUMENT_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * The design_documents table behind the Shaper, Bambu and Playground sub-apps.
 *
 * Appended rather than folded into 001, like 002: migrations are append-only
 * and checksummed, and 001's checksum is what proves an already-migrated
 * database matches this build.
 */
export const migration003: Migration = {
  id: '003-design-documents',
  name: 'design documents',
  statements: DESIGN_DOCUMENT_STATEMENTS,
}
