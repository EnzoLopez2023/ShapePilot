// The one-time carry-over of the Library data that lived only in Workshop's
// per-user database: favorites, Bambu Hub links, collections, prints logged by
// hand, and the owner's confirm/reject decisions on printer jobs. Everything
// else a model has (title, status, tags, notes) is in its model.json on the Mac
// and arrives with the organizer's sync.
//
// scripts/library-workshop-export.ts reads a downloaded copy of the Workshop
// database and writes this bundle; POST /api/library/import/workshop dry-runs
// or applies it for the signed-in account.
import { cleanCollectionName, cleanSmartQuery, num } from './library.ts'
import type { LibraryPrintResult, LibraryQuery } from './library.ts'

export const WORKSHOP_BUNDLE_FORMAT = 'shapepilot-library-workshop/1'
/** Workshop's Bambu Hub project page; the Hub stayed in Workshop. */
export const workshopHubUrl = (projectId: number): string => `https://workshop.nintek.com/bambu/${projectId}`

export interface WorkshopBundle {
  format: typeof WORKSHOP_BUNDLE_FORMAT
  /** SHA-256 of the Workshop database file the bundle was read from. */
  sourceSha256: string
  models: { id: string; favorite: boolean; bambuHubUrl: string | null }[]
  collections: {
    name: string
    kind: 'manual' | 'smart'
    query: LibraryQuery | null
    modelIds: string[]
    createdAt: string | null
  }[]
  manualPrints: {
    modelId: string
    title: string | null
    result: LibraryPrintResult
    startedAt: string | null
    endedAt: string | null
    seconds: number | null
    grams: number | null
    notes: string
    createdAt: string
  }[]
  /** A printer job the owner confirmed or rejected; `jobKey` is the ledger's "<connection>:<job>". */
  decisions: {
    jobKey: string
    modelId: string | null
    matchState: 'confirmed' | 'rejected'
    matchScore: number | null
    title: string | null
    result: LibraryPrintResult
    startedAt: string | null
    endedAt: string | null
    seconds: number | null
    grams: number | null
    materials: unknown[]
  }[]
}

interface Tally { applied: number; unchanged: number; skipped: number }

export interface WorkshopImportReport {
  sourceSha256: string
  favorites: Tally
  bambuHubUrls: Tally & { differs: number }
  collections: Tally & { conflicts: string[] }
  collectionMembers: Tally
  manualPrints: Tally
  decisions: Tally
  /** Model ids the bundle names that this Library does not have yet (sync the Mac first). */
  missingModels: string[]
}

const RESULTS: readonly LibraryPrintResult[] = ['completed', 'failed', 'active', 'unknown']
/** The same rule the organizer's sync applies to a model.json id. */
const MODEL_ID_RE = /^[0-9a-f-]{8,64}$/i
const JOB_KEY_RE = /^[^:\s]{1,200}:[^\s]{1,200}$/
const SHA256_RE = /^[0-9a-f]{64}$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown, max: number): string | null => (typeof value === 'string' ? value.slice(0, max) : null)
const result = (value: unknown): LibraryPrintResult =>
  (RESULTS as readonly unknown[]).includes(value) ? value as LibraryPrintResult : 'unknown'

class BundleError extends Error {}

function modelId(value: unknown, where: string): string {
  if (typeof value !== 'string' || !MODEL_ID_RE.test(value)) throw new BundleError(`${where}: invalid model id`)
  return value
}

/** Validates a bundle from the exporter; throws on anything it did not write. */
export function cleanWorkshopBundle(raw: unknown): WorkshopBundle {
  if (!isRecord(raw) || raw.format !== WORKSHOP_BUNDLE_FORMAT) throw new BundleError(`format must be ${WORKSHOP_BUNDLE_FORMAT}`)
  if (typeof raw.sourceSha256 !== 'string' || !SHA256_RE.test(raw.sourceSha256)) throw new BundleError('sourceSha256 is required')
  return {
    format: WORKSHOP_BUNDLE_FORMAT,
    sourceSha256: raw.sourceSha256,
    models: list(raw.models).map((m, i) => {
      if (!isRecord(m)) throw new BundleError(`models[${i}]: object required`)
      const url = text(m.bambuHubUrl, 2_000)
      if (url !== null && !/^https:\/\/[^\s]+$/.test(url)) throw new BundleError(`models[${i}]: bambuHubUrl must be https`)
      return { id: modelId(m.id, `models[${i}]`), favorite: m.favorite === true, bambuHubUrl: url }
    }),
    collections: list(raw.collections).map((c, i) => {
      if (!isRecord(c)) throw new BundleError(`collections[${i}]: object required`)
      const name = cleanCollectionName(c.name)
      if (!name) throw new BundleError(`collections[${i}]: name required`)
      const kind = c.kind === 'smart' ? 'smart' : 'manual'
      return {
        name,
        kind,
        query: kind === 'smart' ? cleanSmartQuery(c.query) : null,
        modelIds: kind === 'manual' ? list(c.modelIds).map((id, j) => modelId(id, `collections[${i}].modelIds[${j}]`)) : [],
        createdAt: text(c.createdAt, 40),
      }
    }),
    manualPrints: list(raw.manualPrints).map((p, i) => {
      if (!isRecord(p)) throw new BundleError(`manualPrints[${i}]: object required`)
      const createdAt = text(p.createdAt, 40)
      if (!createdAt) throw new BundleError(`manualPrints[${i}]: createdAt required`)
      return {
        modelId: modelId(p.modelId, `manualPrints[${i}]`),
        title: text(p.title, 500),
        result: result(p.result),
        startedAt: text(p.startedAt, 40),
        endedAt: text(p.endedAt, 40),
        seconds: num(p.seconds),
        grams: num(p.grams),
        notes: text(p.notes, 4_000) ?? '',
        createdAt,
      }
    }),
    decisions: list(raw.decisions).map((d, i) => {
      if (!isRecord(d)) throw new BundleError(`decisions[${i}]: object required`)
      if (typeof d.jobKey !== 'string' || !JOB_KEY_RE.test(d.jobKey)) throw new BundleError(`decisions[${i}]: invalid jobKey`)
      const matchState = d.matchState === 'confirmed' ? 'confirmed' : d.matchState === 'rejected' ? 'rejected' : null
      if (!matchState) throw new BundleError(`decisions[${i}]: matchState must be confirmed or rejected`)
      return {
        jobKey: d.jobKey,
        modelId: matchState === 'confirmed' ? modelId(d.modelId, `decisions[${i}]`) : null,
        matchState,
        matchScore: num(d.matchScore),
        title: text(d.title, 500),
        result: result(d.result),
        startedAt: text(d.startedAt, 40),
        endedAt: text(d.endedAt, 40),
        seconds: num(d.seconds),
        grams: num(d.grams),
        materials: list(d.materials).slice(0, 16),
      }
    }),
  }
}

export const isWorkshopBundleError = (error: unknown): error is Error => error instanceof BundleError
