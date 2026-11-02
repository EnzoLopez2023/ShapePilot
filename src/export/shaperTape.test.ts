import { describe, expect, test } from 'vitest'
import { DEFAULT_CABINET } from '../features/cabinet/model/cabinet.ts'
import { sideDrawing } from '../features/cabinet/export/cutDrawing.ts'
import { shortCutsAlong } from './passThrough.ts'
import { TAPE_END_MM, TAPE_PITCH_MM, TAPE_WIDTH_MM, placeTapeStrips, tapeLayout } from './shaperTape.ts'

const EIGHTH = 25.4 / 8

describe('tape on an 18-tray side', () => {
  const drawing = sideDrawing({ ...DEFAULT_CABINET, trayCount: 18 })
  const tape = tapeLayout(drawing, EIGHTH)!
  const ys = drawing.layers.find(l => l.cutType === 'exterior')!.polygons.flat().flatMap(r => r.map(p => p[1]))
  const start = Math.min(...ys)
  const dados = shortCutsAlong(drawing, 'y', tape.lengthMm / 2).map(([a, b]) => [a - start, b - start])

  test('strips run across the length, from end to end, no further apart than the pitch', () => {
    expect(tape.axis).toBe('y')
    expect(tape.stripsMm[0]).toBeGreaterThanOrEqual(0)
    expect(tape.stripsMm[0]).toBeLessThanOrEqual(TAPE_END_MM + TAPE_PITCH_MM / 2)
    expect(tape.lengthMm - tape.stripsMm.at(-1)! - TAPE_WIDTH_MM).toBeLessThanOrEqual(TAPE_END_MM + TAPE_PITCH_MM / 2)
    for (let i = 1; i < tape.stripsMm.length; i++) {
      expect(tape.stripsMm[i] - tape.stripsMm[i - 1]).toBeLessThanOrEqual(TAPE_PITCH_MM + 30)
    }
  })

  test('no strip is laid over a dado', () => {
    expect(tape.overCuts).toEqual([])
    for (const s of tape.stripsMm) {
      for (const [a, b] of dados) expect(s + TAPE_WIDTH_MM <= a || s >= b).toBe(true)
    }
  })

  test('every position is a whole 1/8 in', () => {
    for (const s of tape.stripsMm) expect(Math.abs(s / EIGHTH - Math.round(s / EIGHTH))).toBeLessThan(1e-9)
  })
})

test('evenly spaced when nothing is in the way', () => {
  expect(placeTapeStrips(200, [], 1).stripsMm).toEqual([13, 67, 121, 175])
})

test('a strip with nowhere clear to go is reported', () => {
  expect(placeTapeStrips(200, [[0, 200]], 1).overCuts).toEqual([0, 1, 2, 3])
})
