import { accessSync, constants, mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppConfig } from './config.ts'
import { ConfigError } from './config.ts'

const assertWritableDirectory = (path: string, label: string): void => {
  let details
  try {
    details = statSync(path)
    accessSync(path, constants.R_OK | constants.W_OK | constants.X_OK)
  } catch (cause) {
    throw new ConfigError(
      'STORAGE_UNAVAILABLE',
      `${label} is not an accessible writable directory: ${path}`,
      { cause },
    )
  }
  if (!details.isDirectory()) {
    throw new ConfigError('STORAGE_UNAVAILABLE', `${label} is not a directory: ${path}`)
  }
}

export function validateProductionStorage(config: AppConfig): void {
  if (config.nodeEnv !== 'production') return
  if (!config.artifactStoreDir || !config.recoveryWorkDir) {
    throw new ConfigError(
      'STORAGE_UNAVAILABLE',
      'production backup and recovery paths must be configured',
    )
  }

  try {
    if (config.database.initializeEmptySeed) {
      mkdirSync(dirname(config.database.path), { recursive: true, mode: 0o700 })
    }
    mkdirSync(config.artifactStoreDir, { recursive: true, mode: 0o700 })
    mkdirSync(config.assetStoreDir, { recursive: true, mode: 0o700 })
    mkdirSync(config.recoveryWorkDir, { recursive: true, mode: 0o700 })
  } catch (cause) {
    throw new ConfigError(
      'STORAGE_UNAVAILABLE',
      'production data directories could not be created',
      { cause },
    )
  }
  assertWritableDirectory(dirname(config.database.path), 'database parent')
  assertWritableDirectory(config.artifactStoreDir, 'backup root')
  assertWritableDirectory(config.recoveryWorkDir, 'recovery work root')
}
