// The maintenance validators, at the boundaries the route tests only sample.
//
// Dates get most of the attention because they are the only field here with a
// shape that can be right and a value that is still not a day. `2026-02-31`
// passes any regular expression you would write for `YYYY-MM-DD`, and a
// validator that accepted it would store a date the calendar cannot place.
//
// `now` is injected rather than read from the clock, so "in the future" is a
// property these tests can state exactly instead of one that drifts daily.
import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { ApiError } from '../../server/errors/ApiError.ts'
import {
  LIMITS, today, validateDate, validateEventId,
  validateMaintenanceEventInput, validateMaintenanceProfileInput,
} from '../../server/validation/maintenance.ts'
import { MAINTENANCE_TASKS } from '../../lib/contracts/x2dMaintenance.ts'

const NOW = new Date('2026-09-15T12:00:00Z')
const XY = 'xy-axes'

const PROFILE = {
  commissionedOn: '2026-09-04',
  usageTier: 'regular',
  filamentWear: 'standard',
  rollsUsed: 0,
}

/** The field a rejection blamed, or null if it was accepted. */
function rejectedField(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    assert.ok(error instanceof ApiError, 'validators must throw ApiError')
    assert.equal(error.status, 400)
    return (error.details as { field?: string } | undefined)?.field ?? ''
  }
}

describe('validateDate', () => {
  test('accepts a real day at or before today', () => {
    assert.equal(validateDate('2026-09-15', 'd', NOW), '2026-09-15')
    assert.equal(validateDate('2026-09-04', 'd', NOW), '2026-09-04')
    assert.equal(validateDate('2024-02-29', 'd', NOW), '2024-02-29')
  })

  test('refuses a day that does not exist', () => {
    // Each of these matches the pattern and is not a date.
    for (const date of ['2026-02-31', '2026-13-01', '2026-00-10', '2025-02-29', '2026-04-31']) {
      assert.equal(rejectedField(() => validateDate(date, 'd', NOW)), 'd', date)
    }
  })

  test('refuses anything that is not YYYY-MM-DD', () => {
    for (const value of ['15/09/2026', '2026-9-15', '2026-09-15T00:00:00Z', '', 'today']) {
      assert.equal(rejectedField(() => validateDate(value, 'd', NOW)), 'd')
    }
    for (const value of [null, undefined, 20260915, {}, ['2026-09-15']]) {
      assert.equal(rejectedField(() => validateDate(value, 'd', NOW)), 'd')
    }
  })

  test('refuses tomorrow, and the day before the floor', () => {
    assert.equal(rejectedField(() => validateDate('2026-09-16', 'd', NOW)), 'd')
    assert.equal(rejectedField(() => validateDate('2014-12-31', 'd', NOW)), 'd')
    assert.equal(validateDate(LIMITS.earliestDate, 'd', NOW), LIMITS.earliestDate)
  })

  test('today() is the UTC day', () => {
    assert.equal(today(NOW), '2026-09-15')
  })
})

describe('validateMaintenanceProfileInput', () => {
  test('round-trips a valid profile', () => {
    assert.deepEqual(validateMaintenanceProfileInput(PROFILE, NOW), PROFILE)
  })

  test('refuses a tier or wear rate outside the closed set', () => {
    assert.equal(
      rejectedField(() => validateMaintenanceProfileInput(
        { ...PROFILE, usageTier: 'occasional' }, NOW)),
      'usageTier')
    assert.equal(
      rejectedField(() => validateMaintenanceProfileInput(
        { ...PROFILE, filamentWear: 'carbon' }, NOW)),
      'filamentWear')
  })

  test('refuses a roll count that is negative, fractional or absurd', () => {
    for (const rollsUsed of [-1, 1.5, LIMITS.maxRollsUsed + 1, '3', NaN]) {
      assert.equal(
        rejectedField(() => validateMaintenanceProfileInput({ ...PROFILE, rollsUsed }, NOW)),
        'rollsUsed', String(rollsUsed))
    }
    assert.equal(
      validateMaintenanceProfileInput({ ...PROFILE, rollsUsed: LIMITS.maxRollsUsed }, NOW)
        .rollsUsed,
      LIMITS.maxRollsUsed)
  })

  test('refuses a missing field rather than filling one in', () => {
    // A partial profile is not a patch: the route replaces the whole row, so an
    // absent tier would otherwise be silently invented.
    const { usageTier: _drop, ...partial } = PROFILE
    assert.equal(rejectedField(() => validateMaintenanceProfileInput(partial, NOW)), 'usageTier')
  })

  test('refuses an unknown field and a non-object body', () => {
    assert.equal(
      rejectedField(() => validateMaintenanceProfileInput({ ...PROFILE, nozzle: '0.4' }, NOW)),
      'nozzle')
    for (const body of [null, 'profile', 42, [PROFILE]]) {
      assert.equal(rejectedField(() => validateMaintenanceProfileInput(body, NOW)), 'body')
    }
  })
})

describe('validateMaintenanceEventInput', () => {
  test('accepts every task in the catalogue', () => {
    for (const task of MAINTENANCE_TASKS) {
      const input = validateMaintenanceEventInput(
        { taskKey: task.key, performedOn: '2026-09-10' }, NOW)
      assert.equal(input.taskKey, task.key)
    }
  })

  test('refuses a key that is not a task', () => {
    for (const taskKey of ['', 'xy_axes', 'XY-AXES', 'xy-axes ', 'constructor']) {
      assert.equal(
        rejectedField(() => validateMaintenanceEventInput(
          { taskKey, performedOn: '2026-09-10' }, NOW)),
        'taskKey', taskKey)
    }
  })

  test('normalises the note', () => {
    const at = { taskKey: XY, performedOn: '2026-09-10' }
    assert.equal(validateMaintenanceEventInput({ ...at, note: '  oiled  ' }, NOW).note, 'oiled')
    // Empty, blank, absent and null all mean the same thing, and all store null.
    assert.equal(validateMaintenanceEventInput({ ...at, note: '   ' }, NOW).note, null)
    assert.equal(validateMaintenanceEventInput({ ...at, note: '' }, NOW).note, null)
    assert.equal(validateMaintenanceEventInput({ ...at, note: null }, NOW).note, null)
    assert.equal(validateMaintenanceEventInput(at, NOW).note, null)
  })

  test('bounds the note', () => {
    const at = { taskKey: XY, performedOn: '2026-09-10' }
    const longest = 'x'.repeat(LIMITS.maxNoteLength)
    assert.equal(validateMaintenanceEventInput({ ...at, note: longest }, NOW).note, longest)
    assert.equal(
      rejectedField(() => validateMaintenanceEventInput({ ...at, note: `${longest}x` }, NOW)),
      'note')
    assert.equal(rejectedField(() => validateMaintenanceEventInput({ ...at, note: 7 }, NOW)),
      'note')
  })
})

describe('validateEventId', () => {
  test('accepts a positive whole number', () => {
    assert.equal(validateEventId('1'), 1)
    assert.equal(validateEventId('4200'), 4200)
  })

  test('refuses everything else', () => {
    for (const id of ['0', '-1', '1.5', '1e3', '', 'abc', ' 1', '01234567890123456']) {
      assert.equal(rejectedField(() => validateEventId(id)), 'id', id)
    }
  })
})
