// How the Library writes its numbers and names. Print estimates come from the
// slicer in grams and seconds; sizes come from the mesh in millimetres.
import type { LibraryModel, LibraryStatus } from '../../../../lib/contracts/library.ts'

export const STATUS_ORDER: LibraryStatus[] = ['inbox', 'want', 'queued', 'printed', 'failed', 'skip']

export const STATUS_COLOR: Record<LibraryStatus, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  inbox: 'default',
  want: 'info',
  queued: 'warning',
  printed: 'success',
  failed: 'error',
  skip: 'default',
}

const NEW_FOR_MS = 7 * 24 * 60 * 60 * 1000

/** "New" = arrived in the last week and nobody has triaged it yet. */
export function isNewModel(model: Pick<LibraryModel, 'firstSeenAt' | 'status'>, now = Date.now()): boolean {
  return model.status === 'inbox' && now - Date.parse(model.firstSeenAt) < NEW_FOR_MS
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function formatGrams(grams: number | null | undefined): string {
  if (grams == null) return '—'
  return grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${Math.round(grams)} g`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatDimensions(bbox: [number, number, number] | null | undefined): string {
  if (!bbox) return '—'
  return `${bbox.map(v => Math.round(v)).join(' × ')} mm`
}

export const formatLabel = (format: string): string => (format === 'sliced' ? 'Sliced' : format.toUpperCase())

/** Categories starting with "_" are organizer folders; show them as plain words. */
export function categoryLabel(category: string): string {
  if (category === '_Inbox') return 'Inbox'
  if (category === '_Archive') return 'Archive'
  return category
}

export function sourceLabel(site: string | null): string | null {
  switch (site) {
    case 'makerworld': return 'MakerWorld'
    case 'printables': return 'Printables'
    case 'thingiverse': return 'Thingiverse'
    case 'shapepilot': return 'ShapePilot'
    default: return null
  }
}

export function relativeDate(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export const plural = (count: number, one: string): string => `${count} ${count === 1 ? one : `${one}s`}`
