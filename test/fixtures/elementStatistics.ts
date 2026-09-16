// Entirely synthetic monitoring data, shared only by tests and local previews.
import type {
  ElementAccount, ElementConnection, ElementJob, ElementJobInput, ElementSnapshot, ElementSyncState,
} from '../../lib/contracts/elementStatistics.ts'

export const ELEMENT_TEST_NOW = '2026-09-15T18:30:00.000Z'

export const syntheticElementAccount: ElementAccount = {
  accountId: '123456789', name: 'Synthetic household', region: 'global',
  printers: [{
    id: 'SYNTHETIC123', name: 'Synthetic workshop printer', model: 'Synthetic X2D',
    online: true, state: 'RUNNING',
  }],
}

export const syntheticElementConnection: ElementConnection = {
  id: 'a'.repeat(64), accountId: syntheticElementAccount.accountId,
  accountName: syntheticElementAccount.name, region: 'global', printerId: 'SYNTHETIC123',
  printerName: 'Synthetic workshop printer', printerModel: 'Synthetic X2D',
  createdAt: ELEMENT_TEST_NOW, updatedAt: ELEMENT_TEST_NOW,
}

export const syntheticElementSyncState: ElementSyncState = {
  connectionId: syntheticElementConnection.id,
  backfillCursor: null, backfillComplete: true, backfillStartedAt: ELEMENT_TEST_NOW,
  backfillCompletedAt: ELEMENT_TEST_NOW, backfillPages: 1, backfillSeenCursors: [],
  refreshCursor: null, refreshBoundary: null, refreshSeenCursors: [],
  lastAttemptAt: ELEMENT_TEST_NOW, lastSuccessAt: ELEMENT_TEST_NOW,
  lastFullScanAt: ELEMENT_TEST_NOW, nextSyncAt: null, consecutiveFailures: 0,
  remoteTotal: 2, problem: null,
}

export function syntheticElementJob(overrides: Partial<ElementJobInput> = {}): ElementJobInput {
  return {
    id: '900', title: 'Synthetic calibration plate', result: 'completed', rawStatus: '2',
    startedAt: '2026-09-14T16:00:00.000Z', endedAt: '2026-09-14T17:00:00.000Z',
    actualDurationSeconds: 3600, estimatedDurationSeconds: 4200, estimatedWeightGrams: 45,
    estimatedLength: 14, lengthUnit: null,
    materials: [{
      material: 'PLA', filamentId: 'SYNTHETIC-PLA', color: '336699FF',
      estimatedWeightGrams: 45, nozzleId: '0', amsId: '0', slotId: '1',
    }],
    warnings: [], ...overrides,
  }
}

export const syntheticRecordedElementJob = (overrides: Partial<ElementJob> = {}): ElementJob => ({
  ...syntheticElementJob(), connectionId: syntheticElementConnection.id,
  firstSeenAt: ELEMENT_TEST_NOW, lastSeenAt: ELEMENT_TEST_NOW, ...overrides,
})

export const syntheticElementSnapshot: ElementSnapshot = {
  receivedAt: ELEMENT_TEST_NOW, state: 'RUNNING', jobId: '901',
  jobName: 'Synthetic organiser', progressPercent: 42, remainingMinutes: 35,
  currentLayer: 84, totalLayers: 200, nozzleActualC: 215, nozzleTargetC: 220,
  bedActualC: 59, bedTargetC: 60, wifiSignalDbm: -47, printError: '0', hms: [],
  ams: [
    { amsId: '0', slotId: '0', material: 'PETG', subBrand: null, color: '223344FF', remainingPercent: 64, empty: false },
    { amsId: '0', slotId: '1', material: null, subBrand: null, color: null, remainingPercent: null, empty: true },
  ],
  fieldUpdatedAt: Object.fromEntries([
    'state', 'jobId', 'jobName', 'progressPercent', 'remainingMinutes', 'currentLayer',
    'totalLayers', 'nozzleActualC', 'nozzleTargetC', 'bedActualC', 'bedTargetC',
    'wifiSignalDbm', 'printError', 'hms', 'ams',
  ].map(key => [key, ELEMENT_TEST_NOW])),
}
