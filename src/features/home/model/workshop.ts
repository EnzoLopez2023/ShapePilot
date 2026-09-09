// What the workshop holds, and what was touched last.
//
// Everything here is derived from three lists the app already serves. The home
// page asks no new questions of the server -- a dashboard that needs its own
// endpoints is a dashboard that drifts from the pages it summarises.
import type { DesignSummary } from '../../keycap-tray/service.ts'
import type { SwitchTraySummary } from '../../switch-tray/service.ts'
import type { ToolTraySummary } from '../../tool-tray/service.ts'
import type { ProjectSummary } from '../../keycap-projects/model/types.ts'
import type { DocumentSummary } from '../../../services/designDocuments.ts'

export type WorkKind =
  | 'tray' | 'switch-tray' | 'tool-tray' | 'shaper' | 'bambu' | 'playground'

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
  toolTrays: number
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

const DOCUMENT_HREF: Record<Exclude<WorkKind, 'tray' | 'switch-tray' | 'tool-tray'>, string> = {
  shaper: '/shaper-designer',
  bambu: '/bambu-designer',
  playground: '/playground',
}

export interface WorkshopSources {
  projects?: readonly ProjectSummary[]
  trays?: readonly DesignSummary[]
  documents?: readonly DocumentSummary[]
  switchTrays?: readonly SwitchTraySummary[]
  toolTrays?: readonly ToolTraySummary[]
}

/**
 * Which kind wins when two things were touched at the same moment.
 *
 * Higher wins. The keycap tray is first because it is the capability this
 * workbench was built around; the other trays beat a document for the same
 * reason. Written as a rank rather than a chain of ternaries because the chain
 * did not survive a third source and would not survive a fifth.
 */
const RANK: Record<WorkKind, number> = {
  tray: 5,
  'switch-tray': 4,
  'tool-tray': 3,
  shaper: 1,
  bambu: 1,
  playground: 1,
}

export function summarise(sources: WorkshopSources = {}): Workshop {
  const projects = sources.projects ?? []
  const trays = sources.trays ?? []
  const documents = sources.documents ?? []
  const switchTrays = sources.switchTrays ?? []
  const toolTrays = sources.toolTrays ?? []

  const totals: WorkshopTotals = {
    projects: projects.length,
    trays: trays.length,
    pockets: trays.reduce((sum, tray) => sum + tray.pocketCount, 0),
    switchTrays: switchTrays.length,
    toolTrays: toolTrays.length,
    objects: documents.reduce((sum, doc) => sum + doc.objectCount, 0),
    caps: projects.reduce((sum, project) => sum + project.capCount, 0),
  }

  // One candidate per source, then a single reduce. Every source contributes
  // its own already-shaped `LatestWork`, so adding a sixth is one entry here
  // and nothing else.
  const candidates: LatestWork[] = []
  const tray = newest(trays)
  if (tray) {
    candidates.push({
      kind: 'tray',
      id: tray.id,
      name: tray.name,
      context: tray.projectName,
      updatedAt: tray.updatedAt,
      pieces: tray.pocketCount,
      href: `/keycap-tray/${tray.id}`,
    })
  }
  const switchTray = newest(switchTrays)
  if (switchTray) {
    candidates.push({
      kind: 'switch-tray',
      id: switchTray.id,
      name: switchTray.name,
      context: switchTray.switchLabel || null,
      updatedAt: switchTray.updatedAt,
      // A switch tray generates its cells rather than storing them.
      pieces: 0,
      href: `/switch-tray/${switchTray.id}`,
    })
  }
  const toolTray = newest(toolTrays)
  if (toolTray) {
    candidates.push({
      kind: 'tool-tray',
      id: toolTray.id,
      name: toolTray.name,
      context: null,
      updatedAt: toolTray.updatedAt,
      pieces: toolTray.pocketCount,
      href: `/tool-tray/${toolTray.id}`,
    })
  }
  const document = newest(documents)
  if (document) {
    candidates.push({
      kind: document.kind,
      id: document.id,
      name: document.name,
      context: null,
      updatedAt: document.updatedAt,
      pieces: document.objectCount,
      href: DOCUMENT_HREF[document.kind],
    })
  }

  const latest = candidates.reduce<LatestWork | null>((best, c) => {
    if (!best) return c
    if (c.updatedAt > best.updatedAt) return c
    if (c.updatedAt === best.updatedAt && RANK[c.kind] > RANK[best.kind]) return c
    return best
  }, null)

  return {
    totals,
    latest,
    empty: !projects.length && !trays.length && !documents.length
      && !switchTrays.length && !toolTrays.length,
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
