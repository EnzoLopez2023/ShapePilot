import {
  DEFAULT_BASEPLATE, DEFAULT_BIN,
  type GridfinityBaseplateParams, type GridfinityBinParams,
} from '../../../../lib/contracts/gridfinity.ts'

export type GridfinityKind = 'bin' | 'baseplate'

/**
 * What the designer edits. Both parameter sets are kept so flipping between a
 * bin and a baseplate loses nothing; only the one `kind` names is saved.
 */
export interface GridfinityDesign {
  name: string
  notes?: string
  kind: GridfinityKind
  bin: GridfinityBinParams
  baseplate: GridfinityBaseplateParams
  revision: number
}

export interface GridfinityRecord {
  id: string
  name: string
  notes?: string
  kind: GridfinityKind
  params: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface LabelList {
  id: string
  name: string
  items: string[]
  createdAt: string
  updatedAt: string
}

export const emptyDesign = (kind: GridfinityKind = 'bin'): GridfinityDesign => ({
  name: kind === 'bin' ? 'Gridfinity bin' : 'Drawer baseplate',
  kind,
  bin: { ...DEFAULT_BIN },
  baseplate: { ...DEFAULT_BASEPLATE },
  revision: 0,
})

/** A saved record back into the editor, defaults filling anything older. */
export function fromRecord(r: GridfinityRecord): GridfinityDesign {
  const base = emptyDesign(r.kind)
  return {
    ...base,
    name: r.name,
    notes: r.notes,
    ...(r.kind === 'bin'
      ? { bin: { ...DEFAULT_BIN, ...(r.params as Partial<GridfinityBinParams>) } }
      : { baseplate: { ...DEFAULT_BASEPLATE, ...(r.params as Partial<GridfinityBaseplateParams>) } }),
  }
}

/** One-line description for pickers, e.g. "2×3 bin, 6u" or "10×9 baseplate". */
export function describe(kind: GridfinityKind, params: Record<string, unknown>): string {
  if (kind === 'bin') {
    const p = params as Partial<GridfinityBinParams>
    const label = p.labelText ? ` · ${p.labelText}` : ''
    return `${p.gridX ?? '?'}×${p.gridY ?? '?'} bin, ${p.heightUnits ?? '?'}u${label}`
  }
  const p = params as Partial<GridfinityBaseplateParams>
  const inch = (mm?: number) => (mm ? `${+(mm / 25.4).toFixed(2)}"` : '?')
  return `Baseplate for ${inch(p.drawerWidthMm)} × ${inch(p.drawerDepthMm)} drawer`
}
