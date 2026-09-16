// When each maintenance job next falls due.
//
// A pure function of (profile, service log, today) over the committed
// catalogue, with no clock and no fetch of its own -- `today` is passed in.
// That is what makes the whole schedule testable by writing down a date, and it
// is why the server does not compute any of this: it would be a second
// implementation of the same arithmetic, and it would have to guess which day
// it is where the reader is standing.
//
// Dates are handled as `YYYY-MM-DD` strings throughout, converted to whole days
// since the epoch only for arithmetic. No `Date` object ever holds a time here.
// A local-midnight `Date` shifts a day either side of UTC depending on where
// the browser is, and a calendar that disagrees with the wall calendar about
// what day it is would be wrong for every reader outside UTC.
import {
  MAINTENANCE_TASKS, intervalDaysFor, rollRangeFor,
} from '../../../../lib/contracts/x2dMaintenance.ts'
import type {
  FilamentWear, MaintenanceTask, RollRange, UsageTier,
} from '../../../../lib/contracts/x2dMaintenance.ts'

export interface MaintenanceProfile {
  commissionedOn: string
  usageTier: UsageTier
  filamentWear: FilamentWear
  rollsUsed: number
}

export interface MaintenanceEvent {
  id: number
  taskKey: string
  performedOn: string
  note: string | null
  createdAt: string
}

/**
 * How a job is standing today.
 *
 *   overdue    past its due date, or a calibration the axes have invalidated
 *   due-soon   dated, and within the horizon below
 *   scheduled  dated, and further out than that
 *   counted    measured in rolls of filament, not days
 *   watch      no schedule at all; replaced when a symptom appears
 */
export type DueStatus = 'overdue' | 'due-soon' | 'scheduled' | 'counted' | 'watch'

/** How near a due date has to be before the page starts pointing at it. */
export const SOON_DAYS = 14

export interface TaskStanding {
  task: MaintenanceTask
  /** The most recent logged service, or null if it has never been done. */
  lastDone: MaintenanceEvent | null
  /** `YYYY-MM-DD`, or null for the jobs that are not dated. */
  dueOn: string | null
  /** Negative when overdue. Null when `dueOn` is. */
  daysUntilDue: number | null
  status: DueStatus
  /** True when this belongs in the "needs doing" list at the top of the page. */
  needsAttention: boolean
  /** One line saying how often, in words, including whose interval it is. */
  cadence: string
  /** Why it is standing where it is: "36 days overdue", "in 12 rolls". */
  detail: string
  /** Rolls left before the cutter blade is due a look. Only for `counted`. */
  rollsRemaining?: number
  /** Rolls range in force, given what the cutter is mostly cutting. */
  rollRange?: RollRange
}

const MS_PER_DAY = 86_400_000

/** `YYYY-MM-DD` to whole days since the epoch. */
export function toDayNumber(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY)
}

/** Whole days since the epoch back to `YYYY-MM-DD`. */
export function fromDayNumber(days: number): string {
  return new Date(days * MS_PER_DAY).toISOString().slice(0, 10)
}

export const addDays = (date: string, days: number): string =>
  fromDayNumber(toDayNumber(date) + days)

/** Days from `from` to `to`; negative when `to` is the earlier one. */
export const daysBetween = (from: string, to: string): number =>
  toDayNumber(to) - toDayNumber(from)

/**
 * Today where the reader is standing, as `YYYY-MM-DD`. Local parts, not
 * `toISOString`: a reader in Los Angeles at 6pm is still on today's date, and
 * UTC would already have rolled them onto tomorrow.
 */
export function todayLocal(now: Date = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** The newest logged service per task. The log arrives newest-first. */
export function latestByTask(
  events: readonly MaintenanceEvent[],
): Map<string, MaintenanceEvent> {
  const latest = new Map<string, MaintenanceEvent>()
  for (const event of events) {
    const held = latest.get(event.taskKey)
    // Explicit rather than trusting the order, so this is correct for any list.
    if (!held
      || event.performedOn > held.performedOn
      || (event.performedOn === held.performedOn && event.id > held.id)) {
      latest.set(event.taskKey, event)
    }
  }
  return latest
}

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`

const basisNote = (basis: 'bambu' | 'shapepilot'): string =>
  basis === 'bambu' ? 'Bambu’s interval' : 'ShapePilot’s suggestion'

/** "Every 60 days (Bambu's interval)" and the like. */
function cadenceOf(task: MaintenanceTask, tier: UsageTier, wear: FilamentWear): string {
  switch (task.schedule.kind) {
    case 'interval': {
      const days = intervalDaysFor(task, tier) as number
      const every = days % 30 === 0 && days >= 30
        ? `Every ${plural(days / 30, 'month')}`
        : `Every ${plural(days, 'day')}`
      return `${every} · ${basisNote(task.schedule.basis)}`
    }
    case 'rolls': {
      const range = rollRangeFor(task, wear) as RollRange
      return `Every ${range.min}–${range.max} rolls · ${basisNote(task.schedule.basis)}`
    }
    case 'follows':
      return 'After every axis service'
    case 'condition':
      return 'No schedule — replace on inspection'
  }
}

/** How a dated job is standing, in words. */
function datedDetail(daysUntil: number, lastDone: MaintenanceEvent | null): string {
  if (daysUntil < 0) return `${plural(-daysUntil, 'day')} overdue`
  if (daysUntil === 0) return 'Due today'
  if (!lastDone) return `First service due in ${plural(daysUntil, 'day')}`
  return `Due in ${plural(daysUntil, 'day')}`
}

function standingOf(
  task: MaintenanceTask,
  profile: MaintenanceProfile,
  latest: Map<string, MaintenanceEvent>,
  today: string,
): TaskStanding {
  const lastDone = latest.get(task.key) ?? null
  const base = { task, lastDone, cadence: cadenceOf(task, profile.usageTier, profile.filamentWear) }

  switch (task.schedule.kind) {
    case 'interval': {
      // Counted from the last service, or from the day the printer entered
      // service if it has never been done. A printer that arrived last week is
      // not overdue for anything.
      const from = lastDone?.performedOn ?? profile.commissionedOn
      const dueOn = addDays(from, intervalDaysFor(task, profile.usageTier) as number)
      const daysUntilDue = daysBetween(today, dueOn)
      const status: DueStatus = daysUntilDue < 0
        ? 'overdue'
        : daysUntilDue <= SOON_DAYS ? 'due-soon' : 'scheduled'
      return {
        ...base,
        dueOn,
        daysUntilDue,
        status,
        needsAttention: daysUntilDue <= 0,
        detail: datedDetail(daysUntilDue, lastDone),
      }
    }

    case 'follows': {
      // Due because the axes moved, not because time passed. The trigger is the
      // newest qualifying service; it only counts if it is newer than the last
      // calibration, which is exactly "you have taken the axes apart since".
      const triggers = task.schedule.after
        .map(key => latest.get(key))
        .filter((event): event is MaintenanceEvent => Boolean(event))
        .filter(event => !lastDone || event.performedOn > lastDone.performedOn)
      const newest = triggers.reduce<MaintenanceEvent | null>(
        (held, event) => (!held || event.performedOn > held.performedOn ? event : held), null)

      if (!newest) {
        return {
          ...base,
          dueOn: null,
          daysUntilDue: null,
          status: 'scheduled',
          needsAttention: false,
          detail: lastDone
            ? 'Done since the axes were last serviced'
            : 'Due after the next axis service',
        }
      }
      const since = daysBetween(newest.performedOn, today)
      return {
        ...base,
        dueOn: newest.performedOn,
        daysUntilDue: -since,
        status: 'overdue',
        needsAttention: true,
        detail: since === 0
          ? 'The axes were serviced today'
          : `The axes were serviced ${plural(since, 'day')} ago`,
      }
    }

    case 'rolls': {
      const range = rollRangeFor(task, profile.filamentWear) as RollRange
      const rollsRemaining = range.min - profile.rollsUsed
      return {
        ...base,
        dueOn: null,
        daysUntilDue: null,
        status: 'counted',
        // At the bottom of the range it is time to look at the blade; the top
        // of the range is where Bambu stops saying "check" and starts meaning it.
        needsAttention: rollsRemaining <= 0,
        detail: rollsRemaining > 0
          ? `${plural(rollsRemaining, 'roll')} until the next check`
          : `${plural(profile.rollsUsed, 'roll')} since the last check — inspect the blade`,
        rollsRemaining,
        rollRange: range,
      }
    }

    case 'condition':
      return {
        ...base,
        dueOn: null,
        daysUntilDue: null,
        status: 'watch',
        needsAttention: false,
        detail: task.schedule.trigger,
      }
  }
}

/** Every task's standing, in catalogue order. */
export function scheduleFor(
  profile: MaintenanceProfile,
  events: readonly MaintenanceEvent[],
  today: string,
): TaskStanding[] {
  const latest = latestByTask(events)
  return MAINTENANCE_TASKS.map(task => standingOf(task, profile, latest, today))
}

/** The jobs to do now, soonest first. Overdue sorts ahead of merely due. */
export const attentionOf = (schedule: readonly TaskStanding[]): TaskStanding[] =>
  schedule
    .filter(standing => standing.needsAttention)
    .sort((a, b) => (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0))

export interface CalendarDay {
  /** `YYYY-MM-DD`. */
  date: string
  dayOfMonth: number
  inMonth: boolean
  isToday: boolean
  isPast: boolean
  /** Dated tasks falling due on this day. */
  due: TaskStanding[]
}

/**
 * Six weeks of days covering `month`, starting on Monday.
 *
 * Always six rows, so the grid does not change height as you page through the
 * year -- a calendar that reflows under the pointer is a calendar you misclick.
 */
export function monthGrid(
  month: string,
  schedule: readonly TaskStanding[],
  today: string,
): CalendarDay[] {
  const [year, monthNumber] = month.split('-').map(Number)
  const first = Date.UTC(year, monthNumber - 1, 1) / MS_PER_DAY
  // getUTCDay is 0 for Sunday; shift so Monday is 0 and the week starts there.
  const weekday = (new Date(first * MS_PER_DAY).getUTCDay() + 6) % 7

  const dueByDate = new Map<string, TaskStanding[]>()
  for (const standing of schedule) {
    if (!standing.dueOn) continue
    const held = dueByDate.get(standing.dueOn)
    if (held) held.push(standing)
    else dueByDate.set(standing.dueOn, [standing])
  }

  return Array.from({ length: 42 }, (_unused, index) => {
    const date = fromDayNumber(first - weekday + index)
    return {
      date,
      dayOfMonth: Number(date.slice(8)),
      inMonth: date.slice(0, 7) === month,
      isToday: date === today,
      isPast: date < today,
      due: dueByDate.get(date) ?? [],
    }
  })
}

/** `YYYY-MM` shifted by whole months, staying valid across year boundaries. */
export function shiftMonth(month: string, by: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const zeroBased = (year * 12) + (monthNumber - 1) + by
  const shifted = `${Math.floor(zeroBased / 12)}`
  return `${shifted.padStart(4, '0')}-${`${(zeroBased % 12) + 1}`.padStart(2, '0')}`
}
