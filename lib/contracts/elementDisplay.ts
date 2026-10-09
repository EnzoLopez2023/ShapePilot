import type { ElementConnectionState, ElementSnapshot } from './elementStatistics.ts'

export type DisplaySnapshot = Pick<ElementSnapshot,
  'receivedAt' | 'state' | 'jobName' | 'progressPercent' | 'remainingMinutes'
  | 'currentLayer' | 'totalLayers' | 'nozzleActualC' | 'nozzleTargetC'
  | 'bedActualC' | 'bedTargetC' | 'printError' | 'hms'>

export interface DisplayStatus {
  paired: boolean
  expiresAt: string
  printerName: string | null
  connectionState: ElementConnectionState
  freshness: 'fresh' | 'stale' | 'unavailable'
  snapshot: DisplaySnapshot | null
}

export interface DisplayPairing {
  credential: string
  code: string
  expiresAt: string
}

export interface DisplayGrant {
  id: string
  label: string
  connectionId: string
  createdAt: string
  expiresAt: string
}
