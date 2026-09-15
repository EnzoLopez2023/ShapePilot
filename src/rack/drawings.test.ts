import assert from 'node:assert/strict'
import { test } from 'vitest'
import { RACK } from './config.ts'
import { auditDrawings, buildDrawings } from './drawings.ts'

// Both bugs these catch shipped once. The sheets are generated from the same
// geometry as the STLs, but the *detail* views redraw simplified shapes, and
// that is where a drawing can still disagree with the part.
test('the drawing set renders every sheet', () => {
  const html = buildDrawings(RACK)
  assert.equal((html.match(/<svg /g) ?? []).length, 7, 'one figure per sheet')
  assert.ok(html.includes('<title>'), 'needs a title')
})

test('no figure contains a non-finite coordinate', () => {
  // A NaN silently drops the points it touches: sheet 5 drew half an L for a
  // while because a derived value was read off the config instead.
  assert.ok(!/NaN|Infinity/.test(buildDrawings(RACK)))
})

test('nothing is clipped and no two labels collide', () => {
  const issues = auditDrawings(buildDrawings(RACK))
  assert.deepEqual(issues, [], issues.map(i => `fig ${i.figure} ${i.kind}: ${i.detail}`).join('\n'))
})

test('the audit actually catches a broken figure', () => {
  // Guard against the audit quietly passing everything.
  const bad = '<svg viewBox="0 0 100 100"><polygon points="5,5 NaN,NaN"/>' +
    '<text class="note" x="0" y="50">aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</text>' +
    '<text class="note" x="0" y="52">aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</text></svg>'
  const kinds = auditDrawings(bad).map(i => i.kind)
  assert.ok(kinds.includes('nonfinite'), 'should flag NaN')
  assert.ok(kinds.includes('collision'), 'should flag overlapping labels')
  assert.ok(kinds.includes('bounds'), 'should flag overflow')
})

test('the sheets carry the numbers the parts were built from', () => {
  const html = buildDrawings(RACK)
  for (const n of ['82.2', '79', '496.4', '1.65', '155.6', 'stand-off']) {
    assert.ok(html.includes(n), `sheet should quote ${n}`)
  }
})
