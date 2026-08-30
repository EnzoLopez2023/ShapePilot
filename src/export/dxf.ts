// DXF R2000 with LWPOLYLINE, matching the known-good systainer_tray_1_SHAPER.dxf
// that already cuts correctly on the Origin: $INSUNITS 4 (mm). Y stays CAD-up --
// no flip. Generalised from the keycap-tray writer; the byte format is unchanged.
import type { MultiPolygon, Ring } from '../geometry/vec.ts'
import type { CutType } from '../model/document.ts'
import type { CutDrawing } from './cutLayers.ts'

/** Layer names are the DXF-side vocabulary; a cut type maps onto one of them. */
export const DXF_LAYERS = {
  PROFILE: { color: 7 },
  POCKETS: { color: 8 },
  THROUGH: { color: 1 },
  LABELS: { color: 5 },
  ONLINE: { color: 3 },
} as const

export type DxfLayer = keyof typeof DXF_LAYERS

export const DXF_LAYER_FOR: Record<CutType, DxfLayer> = {
  exterior: 'PROFILE',
  pocket: 'POCKETS',
  interior: 'THROUGH',
  guide: 'LABELS',
  online: 'ONLINE',
}

const n = (v: number): string => v.toFixed(4)

/** Group code / value pair. DXF is a flat tagged stream, two lines per pair. */
const pair = (code: number | string, value: string | number): string => `${code}\n${value}\n`

let handleSeq = 0x100
const handle = (): string => (++handleSeq).toString(16).toUpperCase()

function lwpolyline(ring: Ring, layer: DxfLayer): string {
  let s = pair(0, 'LWPOLYLINE') + pair(5, handle()) + pair(100, 'AcDbEntity') + pair(8, layer) +
    pair(100, 'AcDbPolyline') + pair(90, ring.length) + pair(70, 1) // 1 = closed
  for (const [x, y] of ring) s += pair(10, n(x)) + pair(20, n(y))
  return s
}

function layerTable(names: readonly DxfLayer[]): string {
  let s = pair(0, 'TABLE') + pair(2, 'LAYER') + pair(5, handle()) +
    pair(100, 'AcDbSymbolTable') + pair(70, names.length + 1)
  const layer = (name: string, color: number) =>
    pair(0, 'LAYER') + pair(5, handle()) + pair(100, 'AcDbSymbolTableRecord') +
    pair(100, 'AcDbLayerTableRecord') + pair(2, name) + pair(70, 0) +
    pair(62, color) + pair(6, 'CONTINUOUS')
  s += layer('0', 7)
  for (const name of names) s += layer(name, DXF_LAYERS[name].color)
  return s + pair(0, 'ENDTAB')
}

export interface DxfOptions {
  /**
   * Which layers to declare in the table. The keycap tray predates the ONLINE
   * layer and its reference file lists exactly four, so it pins the set; new
   * drawings declare everything.
   */
  declaredLayers?: readonly DxfLayer[]
}

const ALL_LAYERS = Object.keys(DXF_LAYERS) as DxfLayer[]

export function writeDxf(drawing: CutDrawing, opts: DxfOptions = {}): string {
  handleSeq = 0x100

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const entities: string[] = []
  const addMulti = (mp: MultiPolygon, layer: DxfLayer) => {
    for (const poly of mp) for (const ring of poly) entities.push(lwpolyline(ring, layer))
  }

  // Extents come from the exterior layer alone when there is one: it is the
  // stock outline, and a guide mark outside it would otherwise move the origin.
  const exterior = drawing.layers.filter(l => l.cutType === 'exterior')
  const extentSource = exterior.length ? exterior : drawing.layers
  for (const layer of extentSource) {
    for (const poly of layer.polygons) for (const ring of poly) for (const [x, y] of ring) {
      minX = Math.min(minX, x); minY = Math.min(minY, y)
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    }
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0 }

  for (const layer of drawing.layers) addMulti(layer.polygons, DXF_LAYER_FOR[layer.cutType])
  for (const ring of drawing.guideRings ?? []) entities.push(lwpolyline(ring, 'LABELS'))

  const header =
    pair(0, 'SECTION') + pair(2, 'HEADER') +
    pair(9, '$ACADVER') + pair(1, 'AC1015') +
    pair(9, '$HANDSEED') + pair(5, 'FFFF') +
    pair(9, '$INSUNITS') + pair(70, 4) + // 4 = millimetres
    pair(9, '$EXTMIN') + pair(10, n(minX)) + pair(20, n(minY)) + pair(30, '0.0') +
    pair(9, '$EXTMAX') + pair(10, n(maxX)) + pair(20, n(maxY)) + pair(30, '0.0') +
    pair(0, 'ENDSEC')

  const tables = pair(0, 'SECTION') + pair(2, 'TABLES') +
    layerTable(opts.declaredLayers ?? ALL_LAYERS) + pair(0, 'ENDSEC')
  const body = pair(0, 'SECTION') + pair(2, 'ENTITIES') + entities.join('') + pair(0, 'ENDSEC')

  return header + tables + body + pair(0, 'EOF')
}
