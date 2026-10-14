import { describe, expect, test } from 'vitest'
import {
  DEFAULT_CABINET, cabinetDims, checkCabinet, cutList, screwPositionsMm,
} from './cabinet.ts'
import { sideDrawing, topBottomDrawing } from '../export/cutDrawing.ts'
import { writeShaperSvg } from '../../../export/shaperSvg.ts'
import { checkManifold } from '../../../geometry/mesh.ts'
import { meshFromBands } from '../../../geometry/bands.ts'
import { cabinetSolid, drawingBands } from './solid.ts'

describe('the 12-tray sample case', () => {
  const d = cabinetDims(DEFAULT_CABINET)

  test('slots stack at the dado height plus the gap', () => {
    expect(d.pitchMm).toBe(24)
    // Twelve slots plus the solid side below the lowest dado.
    expect(d.interiorHeightMm).toBe(305)
    // Every tray rides in a dado, the lowest included.
    expect(d.dadoFloorsMm).toHaveLength(12)
    expect(d.dadoFloorsMm[0]).toBeCloseTo(29.7)
    expect(d.dadoFloorsMm[11]).toBeCloseTo(293.7)
  })

  test('the lowest and highest dados sit a gap off the bottom and the top', () => {
    const floor = DEFAULT_CABINET.stockMm
    const ceiling = floor + d.interiorHeightMm
    expect(d.dadoFloorsMm[0] - floor).toBeCloseTo(DEFAULT_CABINET.gapMm)
    const top = d.dadoFloorsMm[11] + DEFAULT_CABINET.dadoHeightMm
    expect(ceiling - top).toBeCloseTo(DEFAULT_CABINET.gapMm)
    expect(d.headroomMm).toBeCloseTo(17.6)
  })

  test('the tray spans both dados with a little slop', () => {
    expect(d.interiorWidthMm).toBe(240)
    expect(d.dadoSpanMm).toBe(250)
    expect(d.dadoSpanMm - DEFAULT_CABINET.trayWidthMm).toBe(1)
    expect(d.engagementMm).toBe(4.5)
  })

  test('the case is the tray depth plus the back, and two thicknesses around', () => {
    expect(d.panelDepthMm).toBeCloseTo(172.35)
    expect(d.overallWidthMm).toBeCloseTo(265.4)
    expect(d.overallHeightMm).toBeCloseTo(330.4)
    expect(d.backWidthMm).toBeCloseTo(252.7)
    expect(d.backHeightMm).toBeCloseTo(317.7)
  })

  test('the cut list is three rows and nothing is wrong with it', () => {
    const rows = cutList(DEFAULT_CABINET)
    expect(rows.map(r => [r.part, r.count, +r.lengthMm.toFixed(2), +r.widthMm.toFixed(2)])).toEqual([
      ['Side', 2, 330.4, 172.35],
      ['Top / bottom', 2, 240, 172.35],
      ['Back', 1, 317.7, 252.7],
    ])
    expect(checkCabinet(DEFAULT_CABINET)).toEqual([])
  })

  test('screws land clear of the front edge and the back rabbet', () => {
    const screws = screwPositionsMm(DEFAULT_CABINET)
    expect(screws[0]).toBe(30)
    expect(screws[2]).toBeCloseTo(136)
    expect(screws[2]).toBeLessThan(d.panelDepthMm - DEFAULT_CABINET.backMm)
  })
})

describe('what a wrong case says', () => {
  test('a dado shallower than the tray, or deeper than half the stock', () => {
    const codes = (over: Partial<typeof DEFAULT_CABINET>) =>
      checkCabinet({ ...DEFAULT_CABINET, ...over }).map(w => w.code)
    expect(codes({ dadoHeightMm: 5 })).toContain('dado-too-shallow')
    expect(codes({ dadoDepthMm: 7 })).toContain('dado-too-deep')
    expect(codes({ slideClearanceMm: 8 })).toContain('engagement-thin')
  })
})

describe('the Shaper drawings', () => {
  test('the side carries the panel, every dado and the back rabbet', () => {
    const drawing = sideDrawing(DEFAULT_CABINET)
    expect(drawing.layers.map(l => l.id)).toEqual(['panel', 'tray-dados', 'back-rabbet'])
    const dados = drawing.layers[1]
    expect(dados.polygons).toHaveLength(12)
    expect(dados.depthMm).toBe(5)
    expect(drawing.layers[2].depthMm).toBe(6.35)
    // Dados stop where the rabbet starts, and open at the front edge.
    const [xs] = [dados.polygons[0][0].map(([x]) => x)]
    expect(Math.min(...xs)).toBe(0)
    expect(Math.max(...xs)).toBe(166)
  })

  test('the side SVG comes out at the panel size, in millimetres', () => {
    const svg = writeShaperSvg(sideDrawing(DEFAULT_CABINET))
    expect(svg).toContain('width="172.35mm" height="330.4mm"')
    expect(svg).toContain('shaper:cutDepth="5mm"')
    expect(svg).toContain('shaper:cutType="pocket"')
  })

  test('the top and bottom carry only the back rabbet', () => {
    const drawing = topBottomDrawing(DEFAULT_CABINET)
    expect(drawing.layers.map(l => l.id)).toEqual(['panel', 'back-rabbet'])
    expect(drawing.layers[1].depthMm).toBe(6.35)
  })
})

describe('the French cleat', () => {
  const p = { ...DEFAULT_CABINET, frenchCleat: true }
  const d = cabinetDims(p)
  const c = d.cleat!

  test('the back moves forward by a cleat, and the case deepens to match', () => {
    expect(cabinetDims(DEFAULT_CABINET).cleat).toBeNull()
    expect(d.backInsetMm).toBe(12.7)
    expect(d.panelDepthMm).toBeCloseTo(172.35 + 12.7)
    // Nothing in front of the back changes.
    expect(d.overallHeightMm).toBeCloseTo(330.4)
    expect(d.dadoFloorsMm).toEqual(cabinetDims(DEFAULT_CABINET).dadoFloorsMm)
  })

  test('the two halves fill the pocket and meet on the bevel', () => {
    const [wallX, faceX] = [d.panelDepthMm, d.panelDepthMm - p.cleatThicknessMm]
    const xs = [...c.caseProfile, ...c.wallProfile].map(([x]) => x)
    expect(Math.min(...xs)).toBeCloseTo(faceX)
    expect(Math.max(...xs)).toBeCloseTo(wallX)
    // The case half tops out under the top panel; the bevel is shared.
    expect(Math.max(...c.caseProfile.map(([, y]) => y))).toBeCloseTo(d.overallHeightMm - p.stockMm)
    const bevel = (ring: [number, number][]) => ring.filter(([x, y]) =>
      c.caseProfile.some(([a, b]) => a === x && b === y) &&
      c.wallProfile.some(([a, b]) => a === x && b === y))
    expect(bevel(c.caseProfile)).toHaveLength(2)
    expect(c.wallCleatDropMm).toBeCloseTo(12.7 + 50.8 - 12.7)
    expect(c.liftClearanceMm).toBeGreaterThan(p.cleatThicknessMm)
  })

  test('the cut list gains the cleats and the spacer, and nothing is wrong', () => {
    const rows = cutList(p)
    expect(rows.map(r => r.part)).toEqual(
      ['Side', 'Top / bottom', 'Back', 'French cleat', 'Cleat spacer'])
    expect(rows[3].lengthMm).toBe(d.interiorWidthMm)
    expect(checkCabinet(p)).toEqual([])
  })

  test('a narrow cleat, or a case too short to lift off it, says so', () => {
    const codes = (over: Partial<typeof DEFAULT_CABINET>) =>
      checkCabinet({ ...p, ...over }).map(w => w.code)
    expect(codes({ cleatHeightMm: 20 })).toContain('cleat-too-narrow')
    expect(codes({ trayCount: 2, cleatHeightMm: 80 })).toContain('cleat-no-lift')
  })

  test('the rabbet becomes a groove, a cleat in from the rear edge', () => {
    const side = sideDrawing(p)
    expect(side.layers.map(l => l.id)).toEqual(['panel', 'tray-dados', 'back-groove'])
    const xs = side.layers[2].polygons[0][0].map(([x]) => x)
    expect(Math.min(...xs)).toBe(166)
    expect(Math.max(...xs)).toBeCloseTo(166 + 6.35)
    const top = topBottomDrawing(p)
    const ys = top.layers[1].polygons[0][0].map(([, y]) => y)
    expect(Math.min(...ys)).toBeCloseTo(12.7)
    expect(Math.max(...ys)).toBeCloseTo(12.7 + 6.35)
  })
})

describe('the 3D case', () => {
  test('every panel is closed and right way out, mirrored or not', () => {
    for (const params of [DEFAULT_CABINET, { ...DEFAULT_CABINET, frenchCleat: true }]) {
      const solid = cabinetSolid(params)
      for (const mesh of [solid.caseMesh, solid.trays, solid.wallCleat].filter(m => m !== null)) {
        const report = checkManifold(mesh)
        expect(report.danglingEdges).toBe(0)
        expect(report.volume).toBeGreaterThan(0)
      }
    }
  })

  test('the side is the stock less its dados and rabbet', () => {
    const d = cabinetDims(DEFAULT_CABINET)
    const p = DEFAULT_CABINET
    const side = meshFromBands(drawingBands(sideDrawing(p), p.stockMm))
    const expected = d.panelDepthMm * d.overallHeightMm * p.stockMm
      - 12 * p.trayDepthMm * p.dadoHeightMm * p.dadoDepthMm
      - p.backMm * d.overallHeightMm * p.backMm
    expect(checkManifold(side).volume).toBeCloseTo(expected, 0)
  })

  test('it fills the overall box, and the wall cleat sits inside it', () => {
    const params = { ...DEFAULT_CABINET, frenchCleat: true }
    const d = cabinetDims(params)
    const solid = cabinetSolid(params)
    const [x0, y0, z0, x1, y1, z1] = solid.caseMesh.bbox
    for (const v of [x0, y0, z0]) expect(v).toBeCloseTo(0, 3)
    expect(x1).toBeCloseTo(d.overallWidthMm, 3)
    expect(y1).toBeCloseTo(d.panelDepthMm, 3)
    expect(z1).toBeCloseTo(d.overallHeightMm, 3)
    const w = solid.wallCleat!.bbox
    expect(w[1]).toBeCloseTo(d.panelDepthMm - params.cleatThicknessMm, 3)
    expect(w[4]).toBeCloseTo(d.panelDepthMm, 3)
  })
})
