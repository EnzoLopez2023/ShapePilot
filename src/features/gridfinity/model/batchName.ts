// What a "bin per label" export is called: in the 3MF's title, which the
// Library shows, and in the file's name. Two runs off one list -- lids for the
// 1 x 1 bins, then lids for the 1 x 2 -- must not come out alike.
import { safeFilename } from '../../../export/download.ts'

export interface BatchNameInput {
  listName: string
  heightUnits: number
  /** What the run prints. `blank` marks bins whose labels are glued on. */
  want: { bins: boolean; labels: boolean; lids: boolean }
  blank: boolean
  /** Each bin's footprint in cells, one entry per label. */
  footprints: readonly { gridX: number; gridY: number }[]
}

/** The list's own name gets this much of the file name; the rest says what is in it. */
const LIST_STEM_CHARS = 36

export function batchNames(input: BatchNameInput): { title: string; stem: string } {
  const { want } = input
  const parts = [
    want.bins ? (input.blank ? 'blank bins' : 'bins') : null,
    want.labels ? 'glue-on labels' : null,
    want.lids ? 'lids' : null,
  ].filter((p): p is string => !!p)
  const counts = new Map<string, number>()
  for (const f of input.footprints) {
    const key = `${f.gridX}x${f.gridY}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const sizes = [...counts].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  const what = parts.join(' + ')
  const title = [
    input.listName.trim(),
    what.charAt(0).toUpperCase() + what.slice(1),
    `${input.heightUnits}u`,
    sizes.map(([size, n]) => `${n} × ${size.replace('x', '×')}`).join(', '),
  ].join(' – ')
  const stem = [
    safeFilename(input.listName).slice(0, LIST_STEM_CHARS).replace(/_+$/, ''),
    parts.map(p => p.replace(/\s+/g, '-')).join('+'),
    `${input.heightUnits}u`,
    sizes.map(([size, n]) => `${n}-of-${size}`).join('_'),
  ].join('_')
  return { title, stem }
}
