// Filling a tray from a list of parts, rather than one drop at a time.
//
// Dropping parts by hand places each one in the first gap that will take it,
// in the order they happen to be clicked. That is the right behaviour for a
// drop -- the user chose the moment -- and a poor way to fill a tray, because
// arrival order decides the layout: put the small parts down first and the
// 136 mm channel block has nowhere left to go.
//
// So packing does the two things arrival order cannot. It places the biggest
// parts first, which is the whole of first-fit-decreasing and most of what
// makes bin packing work at all. And it will turn a part a quarter turn when
// that is the only way it fits, which matters on a 249 x 165 mm tray where
// several presets are longer than the short side.
//
// What it deliberately does NOT do is move parts already in the tray. Somebody
// put those there.
import type { PartPreset } from '../model/partPresets.ts'
import type { ToolPocket, ToolTrayDesign } from '../model/types.ts'
import { spotFor } from './place.ts'

export interface PackRequest {
  preset: PartPreset
  count: number
}

export interface PackResult {
  /** Ready for the caller to give ids to and append. */
  placed: Omit<ToolPocket, 'id'>[]
  /** What would not fit, so the answer is never a silent short delivery. */
  unplaced: { label: string; count: number }[]
}

/** Longest side first, then area: the order first-fit-decreasing wants. */
const hardestFirst = (a: PartPreset, b: PartPreset): number => {
  const longest = Math.max(b.widthMm, b.heightMm) - Math.max(a.widthMm, a.heightMm)
  if (Math.abs(longest) > 1e-9) return longest
  return b.widthMm * b.heightMm - a.widthMm * a.heightMm
}

const pocketFrom = (
  preset: PartPreset,
  at: { x: number; y: number },
  quarterTurn: boolean,
): Omit<ToolPocket, 'id'> => ({
  kind: preset.kind,
  label: preset.label,
  presetId: preset.id,
  x: at.x,
  y: at.y,
  widthMm: preset.widthMm,
  heightMm: preset.heightMm,
  ...(quarterTurn ? { rotationDeg: 90 } : {}),
  // COPIED, as a drop does: a tray keeps printing the same after a catalogue
  // edit, and `presetId` rides along as provenance only.
  steps: preset.steps.map(s => ({ ...s })),
  ...(preset.fingerAccess ? { fingerAccess: { ...preset.fingerAccess } } : {}),
})

/**
 * Place every part in `requests` that will fit, largest first, into whatever
 * room is left around the pockets the design already has.
 *
 * Each placement is searched against the design as extended so far, so two
 * parts in one call can no more land on each other than two separate drops
 * could. Upright is tried before the quarter turn, so a part that fits either
 * way keeps the orientation it was measured in.
 */
export function packParts(
  design: ToolTrayDesign,
  requests: readonly PackRequest[],
): PackResult {
  const queue: PartPreset[] = []
  for (const request of requests) {
    for (let i = 0; i < Math.max(0, Math.floor(request.count)); i++) queue.push(request.preset)
  }
  queue.sort(hardestFirst)

  const placed: Omit<ToolPocket, 'id'>[] = []
  const missed = new Map<string, number>()
  // Grown as parts land, so each search sees the ones before it.
  let working = design

  for (const preset of queue) {
    let seat = spotFor(working, preset, false)
    let turned = false
    if (!seat) {
      seat = spotFor(working, preset, true)
      turned = seat !== null
    }
    if (!seat) {
      missed.set(preset.label, (missed.get(preset.label) ?? 0) + 1)
      continue
    }
    const pocket = pocketFrom(preset, seat, turned)
    placed.push(pocket)
    working = { ...working, pockets: [...working.pockets, { ...pocket, id: `pack-${placed.length}` }] }
  }

  return {
    placed,
    unplaced: [...missed].map(([label, count]) => ({ label, count })),
  }
}
