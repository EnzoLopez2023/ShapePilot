import { LIBRARY_STATEMENTS } from '../schema.ts'
import type { Migration } from '../migrate.ts'

/**
 * The model Library, moved here from Workshop: the index of the 3D print files
 * on the owner's Mac, their prints, collections and the organizer's devices.
 *
 * Additive. Every account starts with an empty Library and fills it on the
 * organizer's first sync, which reads each model's folder on the Mac.
 */
export const migration020: Migration = {
  id: '020-library',
  name: 'model library',
  statements: LIBRARY_STATEMENTS,
}
