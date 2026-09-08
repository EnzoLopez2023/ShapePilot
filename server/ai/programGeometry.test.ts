// Withholding an imported outline from the model and restoring it afterwards.
//
// The bug this covers: an SVG import lands as an extrude with hundreds of
// points, the model is asked to echo the whole program back, and it drops
// `params.profile` -- so the answer fails validation with "extrude requires
// params.profile" and a turn as simple as "double the thickness" is impossible.
import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import type { Point2, ShapeProgram } from '../../lib/contracts/shapeProgram.ts'
import { validateShapeProgram } from '../../lib/contracts/shapeProgram.ts'
import {
  MAX_INLINE_RING_POINTS, elideProgramGeometry, restoreProgramGeometry,
} from './programGeometry.ts'

const transform = {
  position: [0, 0, 0] as const, rotationDeg: [0, 0, 0] as const, scale: [1, 1, 1] as const,
}

/** A closed ring of `n` points on a circle of the given radius. */
const ring = (n: number, radius: number): Point2[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return [radius * Math.cos(a), radius * Math.sin(a)] as Point2
  })

const programWith = (profile: Point2[], holes?: Point2[][]): ShapeProgram => ({
  version: 1, units: 'mm',
  parts: [
    {
      id: 'keyboard-holder', name: 'Keyboard Holder.svg', op: 'extrude',
      params: { profile, ...(holes ? { holes } : {}), heightMm: 5 }, transform,
    },
    { id: 'peg', name: 'Peg', op: 'cylinder', params: { radiusMm: 3, heightMm: 8 }, transform },
  ],
})

describe('imported outlines in an AI edit turn', () => {
  test('a large outline is withheld and described instead', () => {
    const elided = elideProgramGeometry(programWith(ring(421, 80), [ring(167, 20)]))

    assert.equal(elided.withheld.size, 1)
    assert.ok(elided.withheld.has('keyboard-holder'))

    const json = JSON.stringify(elided.program)
    assert.ok(!json.includes('"profile"'), 'the ring should not reach the model')
    assert.ok(json.includes('"heightMm":5'), 'the params it may edit still do')
    assert.ok(json.includes('"peg"'), 'other parts are untouched')

    assert.equal(elided.notes.length, 1)
    assert.match(elided.notes[0], /outer ring, 421 points/)
    assert.match(elided.notes[0], /inner ring 1, 167 points/)
    // Coordinates, not just a size: a cutter has to be placed somewhere.
    assert.match(elided.notes[0], /spanning x -80\.0\.\.80\.0, y -80\.0\.\.80\.0 mm/)
    assert.match(elided.notes[0], /thickness 5 mm/)
  })

  test('the model is given a simplified outline it can actually reason about', () => {
    // An L: two long runs and a notch. If the sketch keeps the corners, it is
    // usable for placing a cut; if it keeps arbitrary points, it is not.
    const dense: Point2[] = []
    const corners: Point2[] = [[0, 0], [100, 0], [100, 40], [40, 40], [40, 90], [0, 90]]
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i]
      const b = corners[(i + 1) % corners.length]
      for (let t = 0; t < 80; t++) {
        dense.push([a[0] + (b[0] - a[0]) * (t / 80), a[1] + (b[1] - a[1]) * (t / 80)])
      }
    }
    const note = elideProgramGeometry(programWith(dense)).notes[0]

    const sketch = note.split('\n').find(l => l.trim().startsWith('[')) ?? ''
    const points = [...sketch.matchAll(/\[(-?[\d.]+),(-?[\d.]+)\]/g)]
      .map(m => [Number(m[1]), Number(m[2])] as Point2)

    assert.ok(points.length <= 64, `sketch should be bounded, got ${points.length}`)
    assert.ok(points.length < dense.length / 4, 'and much smaller than the ring')
    for (const corner of corners) {
      assert.ok(
        points.some(p => Math.hypot(p[0] - corner[0], p[1] - corner[1]) < 1.5),
        `corner ${corner.join(',')} should survive simplification`,
      )
    }
  })

  test('the sketch is small enough to be worth sending', () => {
    const note = elideProgramGeometry(programWith(ring(2_000, 80), [ring(400, 20)])).notes[0]
    assert.ok(note.length < 2_500, `note was ${note.length} bytes`)
  })

  test('a small profile stays inline, where the model can legitimately redraw it', () => {
    const small = ring(MAX_INLINE_RING_POINTS, 10)
    const elided = elideProgramGeometry(programWith(small))
    assert.equal(elided.withheld.size, 0)
    assert.equal(elided.notes.length, 0)
    assert.ok(JSON.stringify(elided.program).includes('"profile"'))
  })

  test('an answer that omits the withheld ring validates once it is restored', () => {
    const profile = ring(421, 80)
    const holes = [ring(167, 20)]
    const elided = elideProgramGeometry(programWith(profile, holes))

    // What the model actually returns: the same part, the same id, no geometry.
    const answer = {
      version: 1, units: 'mm',
      parts: [
        {
          id: 'keyboard-holder', name: 'Keyboard Holder.svg', op: 'extrude',
          params: { heightMm: 10 }, transform,
        },
      ],
    }
    assert.throws(() => validateShapeProgram(structuredClone(answer)),
      /extrude requires params\.profile/)

    restoreProgramGeometry(answer, elided.withheld)
    const program = validateShapeProgram(answer)
    const node = program.parts[0]
    assert.ok('params' in node)
    assert.equal(node.params.heightMm, 10, 'the edit the user asked for survives')
    assert.deepEqual(node.params.profile, profile)
    assert.deepEqual(node.params.holes, holes)
  })

  test('points the model invented for a withheld outline are discarded', () => {
    const profile = ring(421, 80)
    const elided = elideProgramGeometry(programWith(profile))
    const answer = {
      version: 1, units: 'mm',
      parts: [{
        id: 'keyboard-holder', name: 'Keyboard Holder.svg', op: 'extrude',
        // A plausible-looking hallucination: the right shape, the wrong part.
        params: { profile: [[0, 0], [10, 0], [10, 10]], heightMm: 10 }, transform,
      }],
    }
    restoreProgramGeometry(answer, elided.withheld)
    const node = validateShapeProgram(answer).parts[0]
    assert.ok('params' in node)
    assert.deepEqual(node.params.profile, profile)
    assert.equal(node.params.holes, undefined, 'holes it never had are not invented either')
  })

  test('geometry is restored inside a boolean, not only at the top level', () => {
    const profile = ring(200, 40)
    const elided = elideProgramGeometry({
      version: 1, units: 'mm',
      parts: [{
        id: 'plate', name: 'Plate', op: 'difference', transform,
        children: [
          { id: 'outline', name: 'Outline', op: 'extrude', params: { profile, heightMm: 5 }, transform },
          { id: 'slot', name: 'Slot', op: 'box', params: { widthMm: 5, depthMm: 5, heightMm: 9 }, transform },
        ],
      }],
    })
    assert.deepEqual([...elided.withheld.keys()], ['outline'])

    const answer = {
      version: 1, units: 'mm',
      parts: [{
        id: 'plate', name: 'Plate', op: 'difference', transform,
        children: [
          { id: 'outline', name: 'Outline', op: 'extrude', params: { heightMm: 12 }, transform },
          { id: 'slot', name: 'Slot', op: 'box', params: { widthMm: 5, depthMm: 5, heightMm: 16 }, transform },
        ],
      }],
    }
    restoreProgramGeometry(answer, elided.withheld)
    const root = validateShapeProgram(answer).parts[0]
    assert.ok('children' in root)
    const outline = root.children[0]
    assert.ok('params' in outline)
    assert.deepEqual(outline.params.profile, profile)
  })

  test('a part the model turned into something else is left for the validator', () => {
    const elided = elideProgramGeometry(programWith(ring(421, 80)))
    const answer = {
      version: 1, units: 'mm',
      parts: [{
        id: 'keyboard-holder', name: 'Keyboard Holder.svg', op: 'box',
        params: { widthMm: 10, depthMm: 10, heightMm: 10 }, transform,
      }],
    }
    restoreProgramGeometry(answer, elided.withheld)
    const node = validateShapeProgram(answer).parts[0]
    assert.ok('params' in node)
    assert.equal(node.params.profile, undefined)
  })

  test('an outline survives being wrapped in a difference under a new id', () => {
    // The shape of a real "cut a cable slot in it" turn: the import comes back
    // untouched as the first child, with the model's cutter beside it.
    const profile = ring(421, 80)
    const elided = elideProgramGeometry(programWith(profile))
    const answer = {
      version: 1, units: 'mm',
      parts: [{
        id: 'holder-with-slot', name: 'Holder with slot', op: 'difference', transform,
        children: [
          {
            id: 'keyboard-holder', name: 'Keyboard Holder.svg', op: 'extrude',
            params: { heightMm: 5 }, transform,
          },
          {
            id: 'cable-slot', name: 'Cable slot', op: 'box',
            params: { widthMm: 12, depthMm: 30, heightMm: 12 },
            transform: { ...transform, position: [0, -40, -1] },
          },
        ],
      }],
    }
    restoreProgramGeometry(answer, elided.withheld)
    const root = validateShapeProgram(answer).parts[0]
    assert.ok('children' in root)
    assert.equal(root.op, 'difference')
    const outline = root.children[0]
    assert.ok('params' in outline)
    assert.deepEqual(outline.params.profile, profile, 'the import is unchanged')
    assert.equal(root.children[1].name, 'Cable slot', 'and the cutter came with it')
  })

  test('an outline the model renamed the id of is matched back by name', () => {
    const profile = ring(421, 80)
    const elided = elideProgramGeometry(programWith(profile))
    const answer = {
      version: 1, units: 'mm',
      parts: [{
        id: 'holder', name: 'Holder', op: 'union', transform,
        children: [
          // The id moved to the wrapper and the extrude was renumbered -- the
          // mistake the instructions warn against, and no reason to lose a turn.
          {
            id: 'keyboard-holder-outline', name: 'Keyboard Holder.svg', op: 'extrude',
            params: { heightMm: 5 }, transform,
          },
          {
            id: 'foot', name: 'Foot', op: 'box',
            params: { widthMm: 20, depthMm: 20, heightMm: 4 }, transform,
          },
        ],
      }],
    }
    restoreProgramGeometry(answer, elided.withheld)
    const root = validateShapeProgram(answer).parts[0]
    assert.ok('children' in root)
    const outline = root.children[0]
    assert.ok('params' in outline)
    assert.deepEqual(outline.params.profile, profile)
  })

  test('the name fallback does not fill a part that already has its own profile', () => {
    const elided = elideProgramGeometry(programWith(ring(421, 80)))
    const drawn: Point2[] = [[0, 0], [10, 0], [10, 10]]
    const answer = {
      version: 1, units: 'mm',
      parts: [{
        id: 'something-else', name: 'Keyboard Holder.svg', op: 'extrude',
        params: { profile: drawn, heightMm: 5 }, transform,
      }],
    }
    restoreProgramGeometry(answer, elided.withheld)
    const node = validateShapeProgram(answer).parts[0]
    assert.ok('params' in node)
    assert.deepEqual(node.params.profile, drawn)
  })

  test('restoring is a no-op when nothing was withheld', () => {
    const answer = { version: 1, units: 'mm', parts: [] }
    const before = JSON.stringify(answer)
    restoreProgramGeometry(answer, new Map())
    assert.equal(JSON.stringify(answer), before)
  })
})
