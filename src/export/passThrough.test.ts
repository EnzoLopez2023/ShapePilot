import { describe, expect, test } from 'vitest'
import { BENCHPILOT_REACH } from '../model/benchpilot.ts'
import { DEFAULT_CABINET } from '../features/cabinet/model/cabinet.ts'
import { sideDrawing } from '../features/cabinet/export/cutDrawing.ts'
import { guideHtml } from '../features/cabinet/export/guideHtml.ts'
import { forReach, passThroughSegments, planPassThrough, splitForPassThrough } from './passThrough.ts'
import { writeShaperSvg } from './shaperSvg.ts'

const reach = BENCHPILOT_REACH.workstation
const tall = { ...DEFAULT_CABINET, trayCount: 18 }

const extent = (rings: readonly (readonly (readonly [number, number])[])[], axis: 0 | 1) => {
  const vs = rings.flatMap(r => r.map(p => p[axis]))
  return [Math.min(...vs), Math.max(...vs)]
}

describe('an 18-tray side on the Workstation', () => {
  const drawing = sideDrawing(tall)
  const plan = planPassThrough(drawing, reach, 6.35)!
  const split = splitForPassThrough(drawing, plan)

  test('is split in two along its length, the reach width', () => {
    expect(plan.axis).toBe('y')
    expect(plan.alongReachWidth).toBe(true)
    expect(plan.windows).toHaveLength(2)
  })

  test('the seam overlap misses every dado', () => {
    const dados = drawing.layers.find(l => l.id === 'tray-dados')!.polygons
    for (const s of plan.seamsMm) {
      for (const poly of dados) {
        const [a, b] = extent(poly, 1)
        expect(s + plan.overlapMm <= a || s - plan.overlapMm >= b).toBe(true)
      }
    }
  })

  test('the outline becomes two open on-line cuts, each inside the reach', () => {
    const outlines = split.layers.filter(l => l.id.startsWith('outline-segment-'))
    expect(outlines.map(l => l.cutType)).toEqual(['online', 'online'])
    expect(split.layers.some(l => l.cutType === 'exterior')).toBe(false)
    for (const l of outlines) {
      const [y0, y1] = extent(l.openPaths!, 1)
      const [x0, x1] = extent(l.openPaths!, 0)
      expect(y1 - y0).toBeLessThanOrEqual(reach.widthMm)
      expect(x1 - x0).toBeCloseTo(drawing.layers[0].polygons[0][0][1][0] + 6.35, 6)
    }
  })

  test('the back rabbet is split with overlap; the dados are left whole', () => {
    const backs = split.layers.filter(l => l.id.startsWith('back-'))
    expect(backs.map(l => l.id)).toEqual(['back-rabbet-segment-1', 'back-rabbet-segment-2'])
    const [, end1] = extent(backs[0].polygons.flat(), 1)
    const [start2] = extent(backs[1].polygons.flat(), 1)
    expect(end1 - start2).toBeCloseTo(plan.overlapMm * 2, 6)
    expect(split.layers.find(l => l.id === 'tray-dados')!.polygons)
      .toEqual(drawing.layers.find(l => l.id === 'tray-dados')!.polygons)
  })

  test('the SVG carries the segments and the finished edge as a guide', () => {
    const svg = writeShaperSvg(split)
    expect(svg).toContain('id="outline-segment-2" shaper:cutType="online"')
    expect(svg).toContain('id="back-rabbet-segment-1" shaper:cutType="pocket"')
    expect(svg).toContain('PASS-THROUGH in 2 segments')
  })

  test('the build guide calls it pass-through rather than too big', () => {
    const html = guideHtml(tall, { title: 't', imperial: false, marginMm: 20, reach })
    expect(html).toContain('Pass-through, 2 segments')
  })
})

test('a panel that fits is exported unchanged', () => {
  const drawing = sideDrawing(DEFAULT_CABINET)
  expect(forReach(drawing, reach)).toBe(drawing)
  expect(forReach(drawing, null)).toBe(drawing)
})

test('a part too wide both ways cannot pass through', () => {
  expect(passThroughSegments(reach, 500, 1000, 6.35)).toBeNull()
})

test('a long part on the bench passes through in as many segments as it needs', () => {
  expect(passThroughSegments(BENCHPILOT_REACH.bench, 300, 1200, 6.35)?.count).toBe(3)
})

describe('fed front to back', () => {
  const drawing = sideDrawing(tall)

  test('the 18-tray side is split to fit the Workstation depth', () => {
    const plan = planPassThrough(drawing, reach, 6.35, 'front-to-back')!
    expect(plan.alongReachWidth).toBe(false)
    for (const [a, b] of plan.windows) expect(b - a + 6.35 / 2).toBeLessThanOrEqual(reach.heightMm)
  })

  test('a longer side takes more segments front to back than sideways', () => {
    const long = sideDrawing({ ...DEFAULT_CABINET, trayCount: 30 })
    const along = planPassThrough(long, reach, 6.35, 'sideways')!.windows.length
    expect(planPassThrough(long, reach, 6.35, 'front-to-back')!.windows.length).toBeGreaterThan(along)
  })

  test('a part too wide to feed that way does not pass through', () => {
    expect(passThroughSegments(reach, 300, 1000, 6.35, 'sideways')).toBeNull()
    expect(passThroughSegments(reach, 300, 1000, 6.35, 'front-to-back')?.alongReachWidth).toBe(false)
  })
})
