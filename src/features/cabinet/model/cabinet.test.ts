import { describe, expect, test } from 'vitest'
import {
  DEFAULT_CABINET, cabinetDims, checkCabinet, cutList, screwPositionsMm,
} from './cabinet.ts'
import { sideDrawing, topBottomDrawing } from '../export/cutDrawing.ts'
import { writeShaperSvg } from '../../../export/shaperSvg.ts'

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
