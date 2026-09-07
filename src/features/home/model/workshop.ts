// What the workshop holds, and what was touched last.
//
// Everything here is derived from three lists the app already serves. The home
// page asks no new questions of the server -- a dashboard that needs its own
// endpoints is a dashboard that drifts from the pages it summarises.
import type { DesignSummary } from '../../keycap-tray/service.ts'
import type { SwitchTraySummary } from '../../switch-tray/service.ts'
import type { ProjectSummary } from '../../keycap-projects/model/types.ts'
import type { DocumentSummary } from '../../../services/designDocuments.ts'

export type WorkKind = 'tray' | 'switch-tray' | 'shaper' | 'bambu' | 'playground'

export interface LatestWork {
  kind: WorkKind
  id: string
  name: string
  /** The project a tray belongs to, when it belongs to one. */
  context: string | null
  updatedAt: string
  /** What it holds: pockets for a tray, objects for a document. A switch tray
   *  generates its cells rather than storing them, so it reports none. */
  pieces: number
  href: string
}

export interface WorkshopTotals {
  projects: number
  trays: number
  pockets: number
  switchTrays: number
  /** Solids and paths across the Shaper, Bambu and Playground documents. */
  objects: number
  /** Caps catalogued across every project's set. */
  caps: number
}

export interface Workshop {
  totals: WorkshopTotals
  latest: LatestWork | null
  /** True only when nothing at all has been made yet. */
  empty: boolean
}

/**
 * SQLite writes `datetime('now')` -- UTC with no zone marker. Comparing those
 * strings works because the format is fixed-width and lexicographic, which is
 * why this sorts on the raw value rather than parsing a Date per row.
 */
const newest = <T extends { updatedAt: string }>(rows: readonly T[]): T | null =>
  rows.reduce<T | null>(
    (best, row) => (best === null || row.updatedAt > best.updatedAt ? row : best), null)

const DOCUMENT_HREF: Record<Exclude<WorkKind, 'tray' | 'switch-tray'>, string> = {
  shaper: '/shaper-designer',
  bambu: '/bambu-designer',
  playground: '/playground',
}

export function summarise(
  projects: readonly ProjectSummary[],
  trays: readonly DesignSummary[],
  documents: readonly DocumentSummary[],
  switchTrays: readonly SwitchTraySummary[] = [],
): Workshop {
  const totals: WorkshopTotals = {
    projects: projects.length,
    trays: trays.length,
    pockets: trays.reduce((sum, tray) => sum + tray.pocketCount, 0),
    switchTrays: switchTrays.length,
    objects: documents.reduce((sum, doc) => sum + doc.objectCount, 0),
    caps: projects.reduce((sum, project) => sum + project.capCount, 0),
  }

  const newestTray = newest(trays)
  const newestDocument = newest(documents)
  const newestSwitchTray = newest(switchTrays)

  // A tray, a switch tray and a document can be equally recent; the keycap tray
  // wins the tie because it is the capability this workbench was built around,
  // and a switch tray beats a document for the same reason a tray does.
  const newestOther = newestDocument && newestSwitchTray
    ? (newestSwitchTray.updatedAt >= newestDocument.updatedAt ? 'switch' : 'document')
    : newestSwitchTray ? 'switch' : newestDocument ? 'document' : null
  const otherUpdatedAt = newestOther === 'switch'
    ? newestSwitchTray?.updatedAt
    : newestDocument?.updatedAt

  const latest: LatestWork | null =
    newestTray && (otherUpdatedAt === undefined || newestTray.updatedAt >= otherUpdatedAt)
      ? {
        kind: 'tray',
        id: newestTray.id,
        name: newestTray.name,
        context: newestTray.projectName,
        updatedAt: newestTray.updatedAt,
        pieces: newestTray.pocketCount,
        href: `/keycap-tray/${newestTray.id}`,
      }
      : newestOther === 'switch' && newestSwitchTray
        ? {
          kind: 'switch-tray',
          id: newestSwitchTray.id,
          name: newestSwitchTray.name,
          context: newestSwitchTray.switchLabel || null,
          updatedAt: newestSwitchTray.updatedAt,
          pieces: 0,
          href: `/switch-tray/${newestSwitchTray.id}`,
        }
        : newestDocument
          ? {
            kind: newestDocument.kind,
            id: newestDocument.id,
            name: newestDocument.name,
            context: null,
            updatedAt: newestDocument.updatedAt,
            pieces: newestDocument.objectCount,
            href: DOCUMENT_HREF[newestDocument.kind],
          }
          : null

  return {
    totals,
    latest,
    empty: !projects.length && !trays.length && !documents.length && !switchTrays.length,
  }
}

/** "3 minutes ago", "yesterday", "on 12 August" -- how long ago it was touched. */
export function describeWhen(raw: string, now: number = Date.now()): string {
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return raw

  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
}
