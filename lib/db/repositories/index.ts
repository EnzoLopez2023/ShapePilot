import type { AppDatabase } from '../connection.ts'
import type { Repositories } from './contracts.ts'
import { createAuditRepository } from './audit.ts'
import { createDesignAssetRepository } from './designAssets.ts'
import { createDesignDocumentRepository } from './designDocuments.ts'
import { createFilamentInventoryRepository } from './filaments.ts'
import { createKeycapProjectRepository } from './keycapProjects.ts'
import { createKeycapTrayRepository } from './keycapTrays.ts'
import { createMembershipRepository } from './memberships.ts'
import { createSettingsRepository } from './settings.ts'
import { createSwitchTrayRepository } from './switchTrays.ts'

/** Bind every repository to one open database. */
export const createRepositories = (database: AppDatabase): Repositories => ({
  memberships: createMembershipRepository(database.handle),
  settings: createSettingsRepository(database.handle),
  audit: createAuditRepository(database.handle),
  keycapTrays: createKeycapTrayRepository(database.handle),
  switchTrays: createSwitchTrayRepository(database.handle),
  keycapProjects: createKeycapProjectRepository(database.handle),
  designDocuments: createDesignDocumentRepository(database.handle),
  designAssets: createDesignAssetRepository(database.handle),
  filaments: createFilamentInventoryRepository(database.handle),
})
