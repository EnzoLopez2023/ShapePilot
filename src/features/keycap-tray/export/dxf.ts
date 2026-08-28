// DXF R2000 with LWPOLYLINE, matching the known-good systainer_tray_1_SHAPER.dxf
// that already cuts correctly on the Origin: $INSUNITS 4 (mm), layers
// PROFILE / POCKETS / THROUGH. Y stays CAD-up -- no flip.
import type { MultiPolygon, Ring } from '../geometry/vec.ts'
import { buildRegions } from '../geometry/layers.ts'
import { multiBBox } from '../geometry/vec.ts'
import { pocketRing } from '../geometry/shapes.ts'
import type { TrayDesign } from '../model/types.ts'

export const DXF_LAYERS = {
  PROFILE: { color: 7 },
  POCKETS: { color: 8 },
  THROUGH: { color: 1 },
  LABELS: { color: 5 },
} as const

export type DxfLayer = keyof typeof DXF_LAYERS

const n = (v: number): string => v.toFixed(4)

/** Group code / value pair. DXF is a flat tagged stream, two lines per pair. */
const pair = (code: number | string, value: string | number): string => `${code}\n${value}\n`

function lwpolyline(ring: Ring, layer: DxfLayer): string {
  let s = pair(0, 'LWPOLYLINE') + pair(5, handle()) + pair(100, 'AcDbEntity') + pair(8, layer) +
    pair(100, 'AcDbPolyline') + pair(90, ring.length) + pair(70, 1) // 1 = closed
  for (const [x, y] of ring) s += pair(10, n(x)) + pair(20, n(y))
  return s
}

let handleSeq = 0x100
const handle = (): string => (++handleSeq).toString(16).toUpperCase()

function layerTable(): string {
  const names = Object.keys(DXF_LAYERS) as DxfLayer[]
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

export interface DxfOptions { labelRings?: Ring[] }

export function writeDxf(design: TrayDesign, opts: DxfOptions = {}): string {
  handleSeq = 0x100
  const { profile } = buildRegions(design)
  const bbox = multiBBox(profile)

  const entities: string[] = []
  const addMulti = (mp: MultiPolygon, layer: DxfLayer) => {
    for (const poly of mp) for (const ring of poly) entities.push(lwpolyline(ring, layer))
  }
  addMulti(profile, 'PROFILE')
  for (const p of design.pockets) {
    addMulti([pocketRing(p, design.sizing)], p.isThrough ? 'THROUGH' : 'POCKETS')
  }
  for (const ring of opts.labelRings ?? []) entities.push(lwpolyline(ring, 'LABELS'))

  const header =
    pair(0, 'SECTION') + pair(2, 'HEADER') +
    pair(9, '$ACADVER') + pair(1, 'AC1015') +
    pair(9, '$HANDSEED') + pair(5, 'FFFF') +
    pair(9, '$INSUNITS') + pair(70, 4) + // 4 = millimetres
    pair(9, '$EXTMIN') + pair(10, n(bbox.minX)) + pair(20, n(bbox.minY)) + pair(30, '0.0') +
    pair(9, '$EXTMAX') + pair(10, n(bbox.maxX)) + pair(20, n(bbox.maxY)) + pair(30, '0.0') +
    pair(0, 'ENDSEC')

  const tables = pair(0, 'SECTION') + pair(2, 'TABLES') + layerTable() + pair(0, 'ENDSEC')
  const body = pair(0, 'SECTION') + pair(2, 'ENTITIES') + entities.join('') + pair(0, 'ENDSEC')

  return header + tables + body + pair(0, 'EOF')
}
