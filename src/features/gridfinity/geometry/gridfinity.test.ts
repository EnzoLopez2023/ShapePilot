import { readFileSync } from 'node:fs'
import { parse } from 'opentype.js'
import { describe, expect, it } from 'vitest'
import { checkManifold } from '../../../geometry/mesh.ts'
import { DEFAULT_BASEPLATE, DEFAULT_BIN, parseLabelFile } from '../../../../lib/contracts/gridfinity.ts'
import {
  buildBin, buildBinParts, buildGlueLabel, binDimensions, glueLabelSize, tabText, dividerLayout,
  GLUE_LABEL_MM, GLUE_LABEL_TEXT_MM, LIP_HEIGHT_MM, TEXT_RAISE_MM,
} from './bin.ts'
import { buildBaseplate, planBaseplate, splitAxis, BASEPLATE_HEIGHT_MM, GUTTER_GAP_MM, PLATE_BACK_RIM_MM } from './baseplate.ts'
import { buildGutter, gutterHeightMm } from './gutter.ts'
import { buildLid, lidDimensions, lidSolid, lidTextLayoutFor, LID_TEXT_DEPTH_MM, LID_TOP_MM } from './lid.ts'
import type { Manifold, ManifoldToplevel } from 'manifold-3d'
import { loadManifold } from '../../../csg/manifold.ts'
import type { Mesh } from '../../../geometry/mesh.ts'
import { ring } from './shapes.ts'

const solidOf = (wasm: ManifoldToplevel, m: Mesh): Manifold => new wasm.Manifold(new wasm.Mesh({
  numProp: 3, vertProperties: new Float32Array(m.positions), triVerts: new Uint32Array(m.indices),
}))

const font = (() => {
  const buf = readFileSync('public/fonts/archivo-medium.ttf')
  return parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
})()

const size = (bbox: readonly number[]) => [bbox[3] - bbox[0], bbox[4] - bbox[1], bbox[5] - bbox[2]]

describe('gridfinity bin', () => {
  it('matches the sample 3x2 bin footprint and is watertight', async () => {
    const mesh = await buildBin({ ...DEFAULT_BIN, gridX: 2, gridY: 3, heightUnits: 5 })
    const [w, d, h] = size(mesh.bbox)
    expect(w).toBeCloseTo(83.5, 2)
    expect(d).toBeCloseTo(125.5, 2)
    expect(h).toBeCloseTo(35 + LIP_HEIGHT_MM, 2)
    const report = checkManifold(mesh)
    expect(report.ok).toBe(true)
    expect(report.nonManifoldEdges).toBe(0)
  })

  it('raises the label text off the tab and stays one closed solid', async () => {
    const params = { ...DEFAULT_BIN, labelText: '1-1/4" Coarse' }
    const plain = await buildBin({ ...params, labelText: '' })
    const labelled = await buildBin(params, font)
    expect(labelled.triangleCount).toBeGreaterThan(plain.triangleCount)
    expect(checkManifold(labelled).ok).toBe(true)
    expect(checkManifold(labelled).nonManifoldEdges).toBe(0)
    // Text stands below the lip so a stacked bin never sits on it.
    expect(binDimensions(params).tabTopMm).toBeLessThan(binDimensions(params).wallTopMm)
  })

  it('splits the label into its own body for a second filament', async () => {
    const params = { ...DEFAULT_BIN, labelText: 'No. 8', labelSeparate: true }
    const { body, label } = await buildBinParts(params, font)
    const merged = await buildBin(params, font)
    const bare = await buildBin({ ...params, labelText: '' })
    expect(label).not.toBeNull()
    for (const mesh of [body, label!]) {
      expect(checkManifold(mesh).ok).toBe(true)
      expect(checkManifold(mesh).nonManifoldEdges).toBe(0)
    }
    // The body is the plain bin; the label sits exactly on the tab top.
    expect(body.triangleCount).toBe(bare.triangleCount)
    const tabTop = binDimensions(params).tabTopMm
    expect(label!.bbox[2]).toBeCloseTo(tabTop, 3)
    expect(label!.bbox[5]).toBeCloseTo(tabTop + TEXT_RAISE_MM, 3)
    // buildBin ignores the flag and merges, so one-body exports still work.
    expect(merged.triangleCount).toBeGreaterThan(bare.triangleCount)
    // No text, nothing separate.
    expect((await buildBinParts({ ...params, labelText: '' })).label).toBeNull()
  })

  it('builds every option combination without errors', async () => {
    for (const stackingLip of [true, false]) {
      for (const heightUnits of [2, 3, 12]) {
        const mesh = await buildBin({
          ...DEFAULT_BIN, gridX: 1, gridY: 1, heightUnits, stackingLip, magnets: true, labelText: 'M3',
        }, font)
        const report = checkManifold(mesh)
        expect(report.ok, `${heightUnits}u lip=${stackingLip}`).toBe(true)
        expect(report.nonManifoldEdges).toBe(0)
      }
    }
  })
})

describe('gridfinity bin extras', () => {
  it('splits the bin into even compartments below anything that reaches in', async () => {
    const params = { ...DEFAULT_BIN, gridX: 2, gridY: 2, compartmentsX: 3, compartmentsY: 2, lid: true }
    const d = binDimensions(params)
    const layout = dividerLayout(params, d)
    expect(layout.xs).toHaveLength(2)
    expect(layout.ys).toHaveLength(1)
    expect(layout.xs[1] - layout.xs[0]).toBeCloseTo((d.widthMm - 2.4) / 3, 6)
    // Under the lid's barbs, which reach 1.8 mm below the wall top.
    expect(layout.topMm).toBeLessThan(d.wallTopMm - 1.8)
    const mesh = await buildBin(params)
    expect(checkManifold(mesh).ok).toBe(true)
    expect(checkManifold(mesh).nonManifoldEdges).toBe(0)
    expect(mesh.triangleCount).toBeGreaterThan((await buildBin({ ...params, compartmentsX: 1, compartmentsY: 1 })).triangleCount)
  })

  it('notches the front of the lip for a fingernail only when there is a lid', async () => {
    const wasm = await loadManifold()
    const plain = solidOf(wasm, await buildBin(DEFAULT_BIN)).volume()
    const notched = solidOf(wasm, await buildBin({ ...DEFAULT_BIN, lid: true })).volume()
    expect(notched).toBeLessThan(plain - 5)
    expect(checkManifold(await buildBin({ ...DEFAULT_BIN, lid: true })).ok).toBe(true)
  })
})

describe('gridfinity lid', () => {
  it('only exists for a bin with a stacking lip', async () => {
    expect(await buildLid({ ...DEFAULT_BIN, lid: false })).toBeNull()
    expect(await buildLid({ ...DEFAULT_BIN, lid: true, stackingLip: false })).toBeNull()
  })

  it('sits on the lip, adds only its plate, and prints flat', async () => {
    const params = { ...DEFAULT_BIN, gridX: 2, gridY: 1, heightUnits: 2, lid: true }
    const lid = (await buildLid(params))!
    const bin = binDimensions(params)
    for (const mesh of [lid.seated, lid.print]) {
      const report = checkManifold(mesh)
      expect(report.ok).toBe(true)
      expect(report.nonManifoldEdges).toBe(0)
    }
    // Footprint of the bin; the barbs stay inside it.
    const [w, d] = size(lid.seated.bbox)
    expect(w).toBeCloseTo(bin.widthMm, 2)
    expect(d).toBeCloseTo(bin.depthMm, 2)
    // Its top is the lip's top plus the plate; the barbs reach below the wall top.
    expect(lid.seated.bbox[5]).toBeCloseTo(bin.heightMm + LID_TOP_MM, 2)
    expect(lid.seated.bbox[2]).toBeLessThan(bin.wallTopMm)
    // Turned over, the plate is on the bed.
    expect(lid.print.bbox[2]).toBeCloseTo(0, 3)
    expect(size(lid.print.bbox)[2]).toBeCloseTo(size(lid.seated.bbox)[2], 3)
  })

  it('seats without touching the bin, rests on the lip, and catches when pulled', async () => {
    const wasm = await loadManifold()
    for (const [gridX, gridY, heightUnits] of [[1, 1, 2], [2, 3, 3]]) {
      const params = { ...DEFAULT_BIN, gridX, gridY, heightUnits, lid: true }
      const bin = solidOf(wasm, await buildBin(params))
      const lid = lidSolid(wasm, params)
      const overlap = (dz: number) => bin.intersect(lid.translate([0, 0, dz])).volume()
      expect(overlap(0), 'seated').toBeCloseTo(0, 3)
      // Any lower and the plate is in the lip's top: that is what it rests on.
      expect(overlap(-0.05), 'lowered').toBeGreaterThan(1)
      // Pulled up, the barbs run into the ledge under the lip.
      expect(overlap(0.3), 'lifted').toBeGreaterThan(0.1)
    }
  })

  it('keeps its catch fingers clear of the label tab', () => {
    const params = { ...DEFAULT_BIN, gridX: 1, gridY: 3, lid: true }
    const tabFront = binDimensions(params).depthMm - 1.2 - binDimensions(params).tabDepthMm
    const ys = lidDimensions(params).fingerYs
    expect(ys).toHaveLength(3)
    // Even a 1x1 bin with a tab gets a finger each side.
    expect(lidDimensions({ ...params, gridY: 1 }).fingerYs).toHaveLength(1)
    for (const y of ys) expect(y + 4.8).toBeLessThan(tabFront)
    expect(lidDimensions({ ...params, labelTab: false }).fingerYs).toHaveLength(3)
  })

  it('engraves the label into its top, or makes it an inlay that fills the cut', async () => {
    const params = { ...DEFAULT_BIN, gridX: 2, labelText: 'M3 x 8', lid: true, lidLabel: true }
    const plain = (await buildLid({ ...params, lidLabel: false }, font))!
    const engraved = (await buildLid(params, font))!
    expect(engraved.label).toBeNull()
    expect(engraved.seated.triangleCount).toBeGreaterThan(plain.seated.triangleCount)
    expect(checkManifold(engraved.print).ok).toBe(true)
    const inlaid = (await buildLid({ ...params, labelSeparate: true }, font))!
    const label = inlaid.label!
    expect(checkManifold(label.print).ok).toBe(true)
    // The inlay sits flush in the top, and face down on the bed when printed.
    expect(label.seated.bbox[5]).toBeCloseTo(inlaid.seated.bbox[5], 3)
    expect(label.seated.bbox[5] - label.seated.bbox[2]).toBeCloseTo(LID_TEXT_DEPTH_MM, 3)
    expect(label.print.bbox[2]).toBeCloseTo(0, 3)
  })

  it('builds for every size without errors', async () => {
    for (const [gridX, gridY] of [[1, 1], [3, 2], [1, 4]]) {
      for (const labelTab of [true, false]) {
        const lid = (await buildLid({ ...DEFAULT_BIN, gridX, gridY, labelTab, lid: true }))!
        expect(checkManifold(lid.print).ok, `${gridX}x${gridY} tab=${labelTab}`).toBe(true)
      }
    }
  })
})

describe('gridfinity baseplate', () => {
  it('fills an 18x16 inch drawer and splits it for a 256 mm bed', () => {
    const plan = planBaseplate(DEFAULT_BASEPLATE)
    expect(plan.problem).toBeUndefined()
    expect(plan.cellsX).toBe(10)
    expect(plan.cellsY).toBe(9)
    for (const t of plan.tiles) {
      expect(t.widthMm).toBeLessThanOrEqual(256)
      expect(t.depthMm).toBeLessThanOrEqual(256)
    }
    const width = plan.columns.at(-1)!.to
    expect(width).toBeCloseTo(plan.plateWidthMm, 6)
    expect(plan.columns.reduce((n, c) => n + c.endCell - c.firstCell, 0)).toBe(10)
  })

  it('uses the fewest tiles that fit', () => {
    expect(splitAxis(6, 0, 0, 256)).toHaveLength(1)
    expect(splitAxis(7, 0, 0, 256)).toHaveLength(2)
    expect(splitAxis(6, 10, 10, 256)).toHaveLength(2)
    expect(splitAxis(3, 300, 0, 256)).toBeNull()
  })

  it('reports a drawer too small for one cell', () => {
    expect(planBaseplate({ ...DEFAULT_BASEPLATE, drawerWidthMm: 42, clearanceMm: 1 }).problem).toBeTruthy()
  })

  it('builds watertight tiles', async () => {
    const plan = planBaseplate({ ...DEFAULT_BASEPLATE, drawerWidthMm: 300, drawerDepthMm: 100 })
    const tiles = await buildBaseplate(plan)
    expect(tiles).toHaveLength(2)
    for (const { mesh, tile } of tiles) {
      const report = checkManifold(mesh)
      expect(report.ok).toBe(true)
      expect(report.nonManifoldEdges).toBe(0)
      const [w, d, h] = size(mesh.bbox)
      expect(w).toBeCloseTo(tile.widthMm, 3)
      expect(d).toBeCloseTo(tile.depthMm, 3)
      expect(h).toBeCloseTo(BASEPLATE_HEIGHT_MM, 3)
    }
  })
})

describe('label files', () => {
  it('keeps one trimmed item per line, without blanks or repeats', () => {
    const { items, truncated } = parseLabelFile('\uFEFF M3 x 8 \r\n\r\nM3  x 8\nm3 x 8\nM4\n' + 'x'.repeat(80))
    expect(items).toEqual(['M3 x 8', 'M4', 'x'.repeat(60)])
    expect(truncated).toBe(1)
  })

  it.each(['systainer-s76-notched', 'systainer-s76-plain'] as const)(
    'fits a %s insert in one tile, grid clear of the notches', async container => {
      const plan = planBaseplate({ ...DEFAULT_BASEPLATE, container })
      expect(plan.problem).toBeUndefined()
      expect([plan.cellsX, plan.cellsY]).toEqual([5, 3])
      expect(plan.tiles).toHaveLength(1)
      expect(plan.outline).toBeDefined()
      const [tile] = await buildBaseplate(plan)
      const [w, d, h] = size(tile.mesh.bbox)
      expect(w).toBeCloseTo(plan.plateWidthMm, 0)
      expect(d).toBeCloseTo(plan.plateDepthMm, 0)
      expect(h).toBeCloseTo(BASEPLATE_HEIGHT_MM, 3)
      expect(checkManifold(tile.mesh).ok).toBe(true)
      expect(checkManifold(tile.mesh).nonManifoldEdges).toBe(0)
    })
})

describe('the S76 plate for a case without side brackets', () => {
  it('takes six columns, 255 mm wide, grid at the front, in one X2D tile', async () => {
    const plan = planBaseplate({ ...DEFAULT_BASEPLATE, container: 'systainer-s76-wide' })
    expect(plan.problem).toBeUndefined()
    expect([plan.cellsX, plan.cellsY]).toEqual([6, 3])
    expect(plan.plateWidthMm).toBeCloseTo(255, 3)
    expect(plan.gridX).toBeCloseTo(1.5, 3)
    // Front-most row starts just past where the side walls go straight.
    expect(plan.gridY).toBeGreaterThan(15.4)
    expect(plan.gridY).toBeLessThan(16.5)
    // What is left at the back is the strip to decide about.
    expect(plan.plateDepthMm - plan.gridY - 3 * 42).toBeGreaterThan(23)
    expect(plan.tiles).toHaveLength(1)
    // No bracket slots: the back edge between the hinge lobes runs straight.
    const backEdge = plan.outline![0].filter(([, y]) => y > 150 && y < 162.7)
    expect(backEdge.every(([x]) => x < 12 || x > 243)).toBe(true)
    const [tile] = await buildBaseplate(plan)
    const [w, d, h] = size(tile.mesh.bbox)
    expect(w).toBeCloseTo(255, 1)
    expect(d).toBeCloseTo(plan.plateDepthMm, 1)
    expect(h).toBeCloseTo(BASEPLATE_HEIGHT_MM, 3)
    expect(checkManifold(tile.mesh).ok).toBe(true)
  })
})

describe('the gutter behind a wide S76 plate', () => {
  const params = { ...DEFAULT_BASEPLATE, container: 'systainer-s76-wide' as const, gutter: true, gutterCompartments: 3 }

  it('cuts the plate behind the grid and fills the rest of the case', async () => {
    const plan = planBaseplate(params)
    expect(plan.problem).toBeUndefined()
    expect([plan.cellsX, plan.cellsY]).toEqual([6, 3])
    expect(plan.plateDepthMm).toBeCloseTo(plan.gridY + 3 * 42 + PLATE_BACK_RIM_MM, 6)
    const [tile] = await buildBaseplate(plan)
    expect(size(tile.mesh.bbox)[1]).toBeCloseTo(plan.plateDepthMm, 1)

    const gutter = await buildGutter(plan, params)
    expect(gutter).not.toBeNull()
    const m = gutter!
    expect(checkManifold(m).ok).toBe(true)
    // Clear of the plate, inside the insert's own depth, full width at most.
    expect(m.bbox[1]).toBeGreaterThanOrEqual(plan.plateDepthMm + GUTTER_GAP_MM - 1e-3)
    expect(m.bbox[4]).toBeLessThanOrEqual(165.49)
    expect(m.bbox[0]).toBeGreaterThanOrEqual(-1e-3)
    expect(m.bbox[3]).toBeLessThanOrEqual(255 + 1e-3)
    expect(m.bbox[5]).toBeCloseTo(gutterHeightMm(params), 3)
    expect(gutterHeightMm(params)).toBeLessThanOrEqual(48)
  })

  it('is hollow, and its compartments add walls', async () => {
    const plan = planBaseplate(params)
    const vol = (m: Mesh) => {
      let v = 0
      const p = m.positions
      for (let t = 0; t < m.indices.length; t += 3) {
        const [a, b, c] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3]
        v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
          - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
          + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6
      }
      return Math.abs(v)
    }
    const one = vol((await buildGutter(plan, { ...params, gutterCompartments: 1 }))!)
    const three = vol((await buildGutter(plan, params))!)
    const [w, d, h] = size((await buildGutter(plan, params))!.bbox)
    expect(one).toBeLessThan(0.35 * w * d * h)
    // Two dividers, 1.2 mm thick and full height, across the trough.
    expect(three - one).toBeGreaterThan(1500)
  })

  it('has no gutter unless asked, and only on the wide plate', () => {
    expect(planBaseplate({ ...params, gutter: false }).gutterOutline).toBeUndefined()
    expect(planBaseplate({ ...params, container: 'systainer-s76-notched' }).gutterOutline).toBeUndefined()
  })
})

/**
 * What Bambu Studio's mesh check trips on even in a closed, consistently wound
 * mesh: two vertices at one position (a pinch it welds into a non-manifold
 * edge) and zero-area triangles. Both came from extras cut flush with the
 * outer wall, and Studio reported them as "reversed faces".
 */
function slicerDefects(m: Mesh): { duplicateVertices: number; zeroAreaTriangles: number } {
  const p = m.positions
  const seen = new Set<string>()
  let duplicateVertices = 0
  for (let i = 0; i < p.length; i += 3) {
    const key = `${p[i]},${p[i + 1]},${p[i + 2]}`
    if (seen.has(key)) duplicateVertices++
    else seen.add(key)
  }
  let zeroAreaTriangles = 0
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3]
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]]
    const w = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    if (Math.hypot(n[0], n[1], n[2]) === 0) zeroAreaTriangles++
  }
  return { duplicateVertices, zeroAreaTriangles }
}

describe('bins Bambu Studio accepts without a mesh error', () => {
  it('puts no corner vertex on the 45° diagonal Studio fires a check ray down', () => {
    // An even segment count does, and that ray then slips between two facets.
    const r = 3.75
    const corner = ring({ x: 0, y: 0, w: 41.5, d: 41.5, r }, 0, 0)
      .filter(([x, y]) => x < r && y < r)
    for (const [x, y] of corner) expect(Math.abs((x - r) - (y - r))).toBeGreaterThan(0.01)
  })

  const clean = { duplicateVertices: 0, zeroAreaTriangles: 0 }
  const cases: [string, Partial<typeof DEFAULT_BIN>][] = [
    ['1x1 scoop + tab + text', { gridX: 1, gridY: 1, heightUnits: 6, labelText: 'M3 x 30 Button' }],
    ['2x1 scoop + tab + text', { gridX: 2, gridY: 1, heightUnits: 6, labelText: 'M3 x 35 Socket cap' }],
    ['3x2 dividers + magnets', { gridX: 3, gridY: 2, heightUnits: 3, compartmentsX: 3, compartmentsY: 2, magnets: true, labelText: 'Bits' }],
    ['1x1 lid notch, no lip text', { gridX: 1, gridY: 1, heightUnits: 3, lid: true, labelText: '' }],
  ]
  it.each(cases)('%s', async (_name, patch) => {
    const params = { ...DEFAULT_BIN, labelTab: true, scoop: true, stackingLip: true, ...patch }
    const { body } = await buildBinParts(params, font)
    const separate = await buildBinParts({ ...params, labelSeparate: true }, font)
    const lid = await buildLid({ ...params, lid: true, lidLabel: true }, font)
    const lidInlay = await buildLid({ ...params, lid: true, lidLabel: true, labelSeparate: true }, font)
    const glued = await buildBinParts({ ...params, labelGlued: true }, font)
    const strip = await buildGlueLabel({ ...params, labelGlued: true }, font)
    const stripInlay = await buildGlueLabel({ ...params, labelGlued: true, labelSeparate: true }, font)
    const parts: Record<string, Mesh | null | undefined> = {
      bin: body, 'bin, label apart': separate.body, label: separate.label,
      'blank bin': glued.body, 'glue-on label': strip?.print,
      'glue-on label, inlay apart': stripInlay?.print, 'glue-on inlay': stripInlay?.label?.print,
      lid: lid?.print, 'lid, inlay apart': lidInlay?.print, inlay: lidInlay?.label?.print,
    }
    for (const [part, mesh] of Object.entries(parts)) {
      if (mesh) expect({ part, ...slicerDefects(mesh) }).toEqual({ part, ...clean })
    }
  })
})

describe('labels that print legibly', () => {
  const lidded = { ...DEFAULT_BIN, stackingLip: true, lid: true, lidLabel: true }

  it('puts only the size on the tab, grown to fill it', async () => {
    expect(tabText({ ...DEFAULT_BIN, labelText: 'M5 x 12 Button' })).toBe('M5x12')
    expect(tabText({ ...DEFAULT_BIN, labelText: 'M5 Hex nuts' })).toBe('M5')
    expect(tabText({ ...DEFAULT_BIN, labelText: 'M5 Hex nuts', labelSizeOnly: false })).toBe('M5 Hex nuts')
    const params = { ...DEFAULT_BIN, gridX: 1, gridY: 1, labelText: 'M5 x 12 Button', labelSeparate: true, textSizeMm: 5 }
    const big = (await buildBinParts(params, font)).label!
    const small = (await buildBinParts({ ...params, labelSizeOnly: false }, font)).label!
    const height = (m: Mesh) => m.bbox[4] - m.bbox[1]
    // The full label at 5 mm keeps its height; the size alone outgrows it.
    expect(height(big)).toBeGreaterThan(height(small) * 1.3)
  })

  it('writes the whole label on the lid, size over description', async () => {
    const square = await lidTextLayoutFor({ ...lidded, gridX: 1, gridY: 1, labelText: 'M5 x 30 Button' }, font)
    expect(square).toMatchObject({ lines: ['M5x30', 'Button'], turned: false })
    expect(square!.scale).toBeGreaterThan(9)
  })

  it('turns the lid label to run along a long lid', async () => {
    const tall = await lidTextLayoutFor({ ...lidded, gridX: 1, gridY: 2, labelText: 'M5 Split Washers' }, font)
    const wide = await lidTextLayoutFor({ ...lidded, gridX: 2, gridY: 1, labelText: 'M5 Split Washers' }, font)
    expect(tall).toMatchObject({ lines: ['M5', 'Split Washers'], turned: true })
    expect(wide).toMatchObject({ turned: false })
    expect(tall!.scale).toBeCloseTo(wide!.scale, 3)
  })
})

describe('blank bins with a glue-on label', () => {
  const params = { ...DEFAULT_BIN, gridX: 1, gridY: 1, heightUnits: 3, stackingLip: true, labelTab: true, labelText: 'M5 x 12 Button' }

  it('drops the shelf by the label, leaves the bin blank, and the label lands where the tab was', async () => {
    const glued = { ...params, labelGlued: true }
    const d = binDimensions(params)
    const g = binDimensions(glued)
    expect(g.tabTopMm).toBe(d.tabTopMm)
    expect(g.shelfTopMm).toBeCloseTo(d.tabTopMm - GLUE_LABEL_MM, 6)
    const parts = await buildBinParts({ ...glued, labelSeparate: true }, font)
    expect(parts.label).toBeNull()
    expect(checkManifold(parts.body).ok).toBe(true)
    // Nothing of the bin stands above the lowered shelf over the tab.
    const strip = await buildGlueLabel({ ...glued, labelSeparate: true }, font)
    expect(strip).not.toBeNull()
    const [sx0, sy0, sz0, sx1, sy1, sz1] = strip!.seated.bbox
    expect(sz0).toBeCloseTo(g.shelfTopMm, 4)
    expect(sz1).toBeCloseTo(d.tabTopMm, 4)
    const wasm = await loadManifold()
    const overlap = solidOf(wasm, parts.body).intersect(solidOf(wasm, strip!.seated))
    expect(overlap.volume()).toBeLessThan(0.01)
    // Inside the walls, against the back wall's inner face.
    const size = glueLabelSize(g)
    expect(sx1 - sx0).toBeCloseTo(size.widthMm, 2)
    expect(sy1 - sy0).toBeCloseTo(size.depthMm, 2)
    expect(sy1).toBeLessThan(g.depthMm - 1.2)
  })

  it('prints face down, inlay flush with the face, both watertight', async () => {
    const strip = await buildGlueLabel({ ...params, labelGlued: true, labelSeparate: true }, font)
    const [, , z0, , , z1] = strip!.print.bbox
    expect(z0).toBeCloseTo(0, 4)
    expect(z1).toBeCloseTo(GLUE_LABEL_MM, 4)
    const inlay = strip!.label!.print.bbox
    expect(inlay[2]).toBeCloseTo(0, 4)
    expect(inlay[5]).toBeCloseTo(GLUE_LABEL_TEXT_MM, 4)
    expect(checkManifold(strip!.print).ok).toBe(true)
    expect(checkManifold(strip!.label!.print).ok).toBe(true)
  })

  it('makes no label for a bin without text or without the option', async () => {
    expect(await buildGlueLabel({ ...params, labelGlued: true, labelText: ' ' }, font)).toBeNull()
    expect(await buildGlueLabel(params, font)).toBeNull()
  })

  it('keeps dividers under the strip', () => {
    const glued = { ...params, gridX: 2, compartmentsX: 2, labelGlued: true }
    expect(dividerLayout(glued, binDimensions(glued)).topMm).toBeLessThanOrEqual(binDimensions(glued).shelfTopMm)
  })
})
