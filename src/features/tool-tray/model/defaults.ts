import type { ToolTrayDesign } from './types.ts'

/**
 * 21 mm: the deepest reference pocket is 19 mm and 2 mm is a sound floor under
 * it. Also two of these stack inside the S 76's 48 mm base cavity with room
 * over, which is how the hand-built reference pair was arranged.
 */
export const DEFAULT_HEIGHT_MM = 21

/** One printed layer on an X2D with a 0.4 mm nozzle. */
export const DEFAULT_LAYER_MM = 0.2

/** Eight layers. Thinner than this and a bin's floor flexes. */
export const DEFAULT_MIN_FLOOR_MM = 1.6

export function emptyDesign(): ToolTrayDesign {
  return {
    id: '',
    name: 'Untitled tool tray',
    profile: { kind: 'preset', id: 'systainer-s76-notched' },
    heightMm: DEFAULT_HEIGHT_MM,
    layerHeightMm: DEFAULT_LAYER_MM,
    minFloorMm: DEFAULT_MIN_FLOOR_MM,
    pockets: [],
    // The S 76 outline carries lift recesses, and a pocket that breaks into one
    // opens a hole in the tray wall. Avoiding them is the safe default; a tray
    // on an outline with none is unaffected either way.
    undersideReliefs: 'avoid',
    revision: 0,
  }
}
