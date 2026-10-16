import { readFileSync } from 'node:fs'
import { parse } from 'opentype.js'
import { describe, expect, it } from 'vitest'
import { checkManifold } from '../../../geometry/mesh.ts'
import { DEFAULT_BASEPLATE, DEFAULT_BIN, parseLabelFile } from '../../../../lib/contracts/gridfinity.ts'
import { buildBin, binDimensions, LIP_HEIGHT_MM } from './bin.ts'
import { buildBaseplate, planBaseplate, splitAxis, BASEPLATE_HEIGHT_MM } from './baseplate.ts'

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
})
