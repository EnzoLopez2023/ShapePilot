// The due-date arithmetic, which is the whole feature.
//
// Everything here is a pure function of a written-down date, so these tests are
// the place the schedule is actually pinned: the page renders what this module
// returns, and a wrong answer here is a printer serviced on the wrong day.
//
// The dates are deliberately awkward -- month ends, a leap day, a year
// boundary, and a reader west of UTC -- because those are the four ways a
// calendar goes wrong and none of them show up in a happy-path fixture.
import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  addDays, attentionOf, daysBetween, fromDayNumber, latestByTask, monthGrid,
  scheduleFor, shiftMonth, todayLocal, toDayNumber,
} from './schedule.ts'
import type { MaintenanceEvent, MaintenanceProfile } from './schedule.ts'

const PROFILE: MaintenanceProfile = {
  commissionedOn: '2026-09-04',
  usageTier: 'regular',
  filamentWear: 'standard',
  rollsUsed: 0,
}

let nextId = 1
const event = (taskKey: string, performedOn: string): MaintenanceEvent => ({
  id: nextId++, taskKey, performedOn, note: null, createdAt: `${performedOn}T12:00:00Z`,
})

const standingOf = (
  key: string, profile: MaintenanceProfile, events: MaintenanceEvent[], today: string,
) => scheduleFor(profile, events, today).find(s => s.task.key === key)!

describe('date arithmetic', () => {
  test('round-trips through day numbers', () => {
    for (const date of ['2026-09-04', '2024-02-29', '1999-12-31', '2026-01-01']) {
      assert.equal(fromDayNumber(toDayNumber(date)), date)
    }
  })

  test('crosses month, year and leap-day boundaries', () => {
    assert.equal(addDays('2026-01-31', 1), '2026-02-01')
    assert.equal(addDays('2026-12-31', 1), '2027-01-01')
    assert.equal(addDays('2024-02-28', 1), '2024-02-29')
    assert.equal(addDays('2025-02-28', 1), '2025-03-01')
    assert.equal(addDays('2026-09-04', 60), '2026-11-03')
  })

  test('daysBetween is signed and symmetric', () => {
    assert.equal(daysBetween('2026-09-04', '2026-09-15'), 11)
    assert.equal(daysBetween('2026-09-15', '2026-09-04'), -11)
    assert.equal(daysBetween('2026-09-04', '2026-09-04'), 0)
  })

  test('todayLocal reads the local date, whatever the zone', () => {
    // Asserted against the Date's own local parts rather than against
    // toISOString, because whether the two agree depends on the zone the suite
    // happens to run in. What must hold everywhere is that late evening and
    // early morning on a day both report that day -- a reader west of UTC at
    // 23:30 has not moved on to tomorrow, and toISOString would say they had.
    for (const at of [
      new Date(2026, 8, 15, 23, 30),
      new Date(2026, 8, 15, 0, 15),
      new Date(2026, 11, 31, 23, 59),
      new Date(2024, 1, 29, 22, 0),
    ]) {
      const expected = `${at.getFullYear()}-`
        + `${`${at.getMonth() + 1}`.padStart(2, '0')}-`
        + `${`${at.getDate()}`.padStart(2, '0')}`
      assert.equal(todayLocal(at), expected)
    }
  })

  test('shiftMonth walks across year boundaries in both directions', () => {
    assert.equal(shiftMonth('2026-09', 1), '2026-10')
    assert.equal(shiftMonth('2026-12', 1), '2027-01')
    assert.equal(shiftMonth('2026-01', -1), '2025-12')
    assert.equal(shiftMonth('2026-09', -12), '2025-09')
  })
})

describe('interval tasks', () => {
  test('a never-done job is counted from the day the printer entered service', () => {
    // XY axes at the regular tier is 60 days, so 4 Sep + 60 = 3 Nov.
    const xy = standingOf('xy-axes', PROFILE, [], '2026-09-15')
    assert.equal(xy.dueOn, '2026-11-03')
    assert.equal(xy.daysUntilDue, 49)
    assert.equal(xy.status, 'scheduled')
    assert.equal(xy.needsAttention, false)
    assert.equal(xy.lastDone, null)
  })

  test('a brand-new printer is overdue for nothing', () => {
    const fresh = scheduleFor(PROFILE, [], '2026-09-04')
    assert.deepEqual(attentionOf(fresh), [])
  })

  test('the usage tier changes the interval, and so the due date', () => {
    const heavy = standingOf('xy-axes', { ...PROFILE, usageTier: 'high' }, [], '2026-09-15')
    const light = standingOf('xy-axes', { ...PROFILE, usageTier: 'low' }, [], '2026-09-15')
    assert.equal(heavy.dueOn, '2026-10-04')
    assert.equal(light.dueOn, '2026-12-03')
  })

  test('a logged service restarts the count from the day it was done', () => {
    const xy = standingOf('xy-axes', PROFILE, [event('xy-axes', '2026-10-01')], '2026-10-05')
    assert.equal(xy.dueOn, '2026-11-30')
    assert.equal(xy.lastDone?.performedOn, '2026-10-01')
  })

  test('the newest service wins regardless of the order it arrives in', () => {
    const events = [event('xy-axes', '2026-09-20'), event('xy-axes', '2026-10-01')]
    const forwards = standingOf('xy-axes', PROFILE, events, '2026-10-05')
    const backwards = standingOf('xy-axes', PROFILE, [...events].reverse(), '2026-10-05')
    assert.equal(forwards.dueOn, '2026-11-30')
    assert.equal(backwards.dueOn, forwards.dueOn)
  })

  test('two services on one day are broken by insertion order', () => {
    const first = event('xy-axes', '2026-10-01')
    const second = event('xy-axes', '2026-10-01')
    const latest = latestByTask([first, second])
    assert.equal(latest.get('xy-axes')?.id, second.id)
  })

  test('past the due date it reads as overdue, by the right number of days', () => {
    const xy = standingOf('xy-axes', PROFILE, [], '2026-12-03')
    assert.equal(xy.status, 'overdue')
    assert.equal(xy.daysUntilDue, -30)
    assert.equal(xy.detail, '30 days overdue')
    assert.equal(xy.needsAttention, true)
  })

  test('due today counts as needing attention, not as merely soon', () => {
    const xy = standingOf('xy-axes', PROFILE, [], '2026-11-03')
    assert.equal(xy.daysUntilDue, 0)
    assert.equal(xy.status, 'due-soon')
    assert.equal(xy.needsAttention, true)
    assert.equal(xy.detail, 'Due today')
  })

  test('the soon horizon is the boundary it claims to be', () => {
    // 14 days out is soon; 15 is not.
    assert.equal(standingOf('xy-axes', PROFILE, [], '2026-10-20').status, 'due-soon')
    assert.equal(standingOf('xy-axes', PROFILE, [], '2026-10-19').status, 'scheduled')
  })

  test('the cadence line names whose interval it is', () => {
    assert.match(standingOf('xy-axes', PROFILE, [], '2026-09-15').cadence, /Bambu/)
    assert.match(standingOf('pei-plate-clean', PROFILE, [], '2026-09-15').cadence, /ShapePilot/)
  })
})

describe('the calibration that follows an axis service', () => {
  test('is not due on a printer whose axes have never been touched', () => {
    const calibration = standingOf('full-calibration', PROFILE, [], '2026-09-15')
    assert.equal(calibration.dueOn, null)
    assert.equal(calibration.needsAttention, false)
    assert.equal(calibration.detail, 'Due after the next axis service')
  })

  test('falls due the moment the axes are serviced', () => {
    const calibration = standingOf(
      'full-calibration', PROFILE, [event('xy-axes', '2026-10-01')], '2026-10-04')
    assert.equal(calibration.status, 'overdue')
    assert.equal(calibration.dueOn, '2026-10-01')
    assert.equal(calibration.needsAttention, true)
    assert.equal(calibration.detail, 'The axes were serviced 3 days ago')
  })

  test('is satisfied by a calibration logged after that service', () => {
    const calibration = standingOf('full-calibration', PROFILE, [
      event('xy-axes', '2026-10-01'),
      event('full-calibration', '2026-10-02'),
    ], '2026-10-04')
    assert.equal(calibration.needsAttention, false)
    assert.equal(calibration.detail, 'Done since the axes were last serviced')
  })

  test('falls due again when the axes are serviced after the calibration', () => {
    const calibration = standingOf('full-calibration', PROFILE, [
      event('xy-axes', '2026-10-01'),
      event('full-calibration', '2026-10-02'),
      event('z-axis', '2026-11-20'),
    ], '2026-11-21')
    assert.equal(calibration.needsAttention, true)
    assert.equal(calibration.dueOn, '2026-11-20')
  })
})

describe('the cutter blade, which is counted in rolls', () => {
  test('never lands on the calendar', () => {
    const blade = standingOf('filament-cutter-blade', PROFILE, [], '2026-09-15')
    assert.equal(blade.dueOn, null)
    assert.equal(blade.status, 'counted')
  })

  test('counts down to the bottom of the range', () => {
    const blade = standingOf(
      'filament-cutter-blade', { ...PROFILE, rollsUsed: 5 }, [], '2026-09-15')
    assert.equal(blade.rollsRemaining, 3)
    assert.equal(blade.needsAttention, false)
    assert.equal(blade.detail, '3 rolls until the next check')
  })

  test('asks to be inspected once the range is reached', () => {
    const blade = standingOf(
      'filament-cutter-blade', { ...PROFILE, rollsUsed: 8 }, [], '2026-09-15')
    assert.equal(blade.rollsRemaining, 0)
    assert.equal(blade.needsAttention, true)
  })

  test('abrasive filament shortens the range', () => {
    const abrasive = { ...PROFILE, filamentWear: 'abrasive' as const, rollsUsed: 6 }
    const blade = standingOf('filament-cutter-blade', abrasive, [], '2026-09-15')
    assert.deepEqual(blade.rollRange, { min: 6, max: 10 })
    assert.equal(blade.needsAttention, true)
    // The same six rolls on standard filament is not yet a check.
    assert.equal(
      standingOf('filament-cutter-blade', { ...PROFILE, rollsUsed: 6 }, [], '2026-09-15')
        .needsAttention,
      false)
  })
})

describe('the condition-based jobs', () => {
  test('carry no date and never demand attention on their own', () => {
    for (const key of ['carbon-filter', 'nozzle-wiper', 'ptfe-tube']) {
      const standing = standingOf(key, PROFILE, [], '2027-06-01')
      assert.equal(standing.status, 'watch')
      assert.equal(standing.dueOn, null)
      assert.equal(standing.needsAttention, false)
    }
  })

  test('say what to watch for instead of when', () => {
    const tube = standingOf('ptfe-tube', PROFILE, [], '2026-09-15')
    assert.match(tube.detail, /slides up and down/)
    assert.equal(tube.cadence, 'No schedule — replace on inspection')
  })
})

describe('the month grid', () => {
  const schedule = scheduleFor(PROFILE, [], '2026-09-15')

  test('is always six Monday-led weeks', () => {
    const days = monthGrid('2026-09', schedule, '2026-09-15')
    assert.equal(days.length, 42)
    // 1 Sep 2026 is a Tuesday, so the grid opens on Monday 31 Aug.
    assert.equal(days[0].date, '2026-08-31')
    assert.equal(days[0].inMonth, false)
    assert.equal(days[1].date, '2026-09-01')
    assert.equal(days[1].inMonth, true)
  })

  test('marks today, and the days behind it', () => {
    const days = monthGrid('2026-09', schedule, '2026-09-15')
    const today = days.find(day => day.date === '2026-09-15')!
    assert.equal(today.isToday, true)
    assert.equal(today.isPast, false)
    assert.equal(days.find(day => day.date === '2026-09-14')!.isPast, true)
  })

  test('puts each dated job on its due day and leaves the undated ones off', () => {
    const days = monthGrid('2026-11', schedule, '2026-09-15')
    const due = days.find(day => day.date === '2026-11-03')!.due
    assert.deepEqual(due.map(standing => standing.task.key), ['chamber-clean', 'xy-axes'])

    const placed = days.flatMap(day => day.due).map(standing => standing.task.key)
    for (const undated of ['filament-cutter-blade', 'ptfe-tube', 'full-calibration']) {
      assert.ok(!placed.includes(undated), `${undated} must not be on the grid`)
    }
  })

  test('a job due in a neighbouring month still shows on the days on show', () => {
    // 1 Dec 2026 falls in the trailing week of the November grid.
    const days = monthGrid('2026-11', scheduleFor(
      { ...PROFILE, commissionedOn: '2026-10-02' }, [], '2026-10-02'), '2026-10-02')
    const december = days.find(day => day.date === '2026-12-01')!
    assert.equal(december.inMonth, false)
    assert.equal(december.due.length, 2)
  })
})

describe('the attention list', () => {
  test('sorts the most overdue first and leaves the rest out', () => {
    const profile = { ...PROFILE, rollsUsed: 20 }
    const schedule = scheduleFor(profile, [], '2026-12-01')
    const attention = attentionOf(schedule)
    const keys = attention.map(standing => standing.task.key)

    // Everything listed genuinely needs doing...
    assert.ok(attention.every(standing => standing.needsAttention))
    // ...the plate (due after 14 days) is more overdue than the axes (60)...
    assert.ok(keys.indexOf('pei-plate-clean') < keys.indexOf('xy-axes'))
    // ...and the watch-list jobs are not in it at all.
    assert.ok(!keys.includes('ptfe-tube'))
    // The blade is, because 20 rolls is past its range.
    assert.ok(keys.includes('filament-cutter-blade'))
  })
})
