// The filament inventory validator, on its own.
//
// The route test proves these rules reach storage; this proves the rules
// themselves, including the shapes a real client would never send. What makes
// this validator different from the others is that its vocabulary is closed:
// both fields are checked against the committed catalogue, so "unknown
// filament" and "impossible variant" are decidable here rather than deferred.
import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { ApiError } from '../../server/errors/ApiError.ts'
import { LIMITS, validateFilamentInventoryInput } from '../../server/validation/filaments.ts'
import { FILAMENT_PAIR_COUNT, filamentsOfLine } from '../../lib/contracts/bambuFilaments.ts'

const JADE_WHITE = filamentsOfLine('bambu-lab/pla/basic').find(c => c.name === 'Jade White')!.key
const ABS_RED = filamentsOfLine('bambu-lab/abs/basic').find(c => c.name === 'Red')!.key

const rejects = (body: unknown, field: string) => {
  assert.throws(() => validateFilamentInventoryInput(body), (error: unknown) => {
    assert.ok(error instanceof ApiError, `expected ApiError, got ${String(error)}`)
    assert.equal(error.status, 400)
    assert.equal((error.details as { field?: string } | undefined)?.field, field)
    return true
  }, `expected a 400 on ${field} for ${JSON.stringify(body)}`)
}

describe('filament inventory validation', () => {
  test('accepts an empty inventory and a well-formed one', () => {
    assert.deepEqual(validateFilamentInventoryInput({ owned: [] }), [])
    assert.deepEqual(
      validateFilamentInventoryInput({
        owned: [{ key: JADE_WHITE, variant: 'refill' }, { key: ABS_RED, variant: 'spool' }],
      }),
      [{ key: JADE_WHITE, variant: 'refill' }, { key: ABS_RED, variant: 'spool' }],
    )
  })

  test('requires an object body carrying only owned', () => {
    rejects(null, 'body')
    rejects('owned', 'body')
    rejects([], 'body')
    rejects({}, 'owned')
    rejects({ owned: [], extra: 1 }, 'extra')
  })

  test('requires owned to be an array of plain objects', () => {
    rejects({ owned: {} }, 'owned')
    rejects({ owned: 'all' }, 'owned')
    rejects({ owned: [null] }, 'owned[0]')
    rejects({ owned: [[]] }, 'owned[0]')
    rejects({ owned: [7] }, 'owned[0]')
  })

  test('requires both fields, and nothing else, on an entry', () => {
    rejects({ owned: [{}] }, 'owned[0].key')
    rejects({ owned: [{ key: JADE_WHITE }] }, 'owned[0].variant')
    rejects({ owned: [{ variant: 'spool' }] }, 'owned[0].key')
    rejects({ owned: [{ key: JADE_WHITE, variant: 'spool', grams: 1000 }] }, 'owned[0].grams')
  })

  test('requires the key to name a real filament', () => {
    rejects({ owned: [{ key: '', variant: 'spool' }] }, 'owned[0].key')
    rejects({ owned: [{ key: 42, variant: 'spool' }] }, 'owned[0].key')
    rejects({ owned: [{ key: 'jade-white', variant: 'spool' }] }, 'owned[0].key')
    // The bare Bambu code is not the key; the path is.
    rejects({ owned: [{ key: '10100', variant: 'spool' }] }, 'owned[0].key')
  })

  test('requires the variant to be one the line is actually sold in', () => {
    rejects({ owned: [{ key: JADE_WHITE, variant: 'bottle' }] }, 'owned[0].variant')
    rejects({ owned: [{ key: JADE_WHITE, variant: 7 }] }, 'owned[0].variant')
    // ABS ships on a reel only.
    rejects({ owned: [{ key: ABS_RED, variant: 'refill' }] }, 'owned[0].variant')
  })

  test('refuses a duplicate pair rather than deduping it', () => {
    rejects({
      owned: [{ key: JADE_WHITE, variant: 'spool' }, { key: JADE_WHITE, variant: 'spool' }],
    }, 'owned[1]')
    // The same filament in two different forms is not a duplicate.
    assert.equal(validateFilamentInventoryInput({
      owned: [{ key: JADE_WHITE, variant: 'spool' }, { key: JADE_WHITE, variant: 'refill' }],
    }).length, 2)
  })

  test('bounds the inventory above what the catalogue can produce', () => {
    assert.ok(LIMITS.maxEntries > FILAMENT_PAIR_COUNT,
      'the limit must not refuse an account that owns everything')
    rejects({
      owned: Array.from({ length: LIMITS.maxEntries + 1 },
        () => ({ key: JADE_WHITE, variant: 'spool' })),
    }, 'owned')
  })
})
