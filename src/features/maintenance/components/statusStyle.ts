// How each standing looks and what it is called, in one place.
//
// Shared by the calendar dots, the task chips and the attention list, so a job
// that is overdue is the same colour and the same word wherever you meet it.
// Colours are theme palette roles rather than literals, so both themes get a
// contrast-checked pair without a second table.
import type { DueStatus } from '../model/schedule.ts'

export type StatusColor = 'error' | 'warning' | 'success' | 'info' | 'default'

export interface StatusStyle {
  label: string
  color: StatusColor
  /** Palette path for the calendar dot, which is not a MUI component. */
  dot: string
}

export const STATUS_STYLE: Record<DueStatus, StatusStyle> = {
  overdue: { label: 'Overdue', color: 'error', dot: 'error.main' },
  'due-soon': { label: 'Due soon', color: 'warning', dot: 'warning.main' },
  scheduled: { label: 'Scheduled', color: 'success', dot: 'success.main' },
  counted: { label: 'By roll count', color: 'info', dot: 'info.main' },
  watch: { label: 'Watch for it', color: 'default', dot: 'text.disabled' },
}

/**
 * A date as a person writes it: "4 Sep 2026".
 *
 * Built from the string's own parts rather than by parsing it into a `Date`,
 * for the reason given in model/schedule.ts -- `new Date('2026-09-04')` is
 * midnight UTC, which renders as the 3rd for most of the Americas.
 */
export function formatDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const formatter = new Intl.DateTimeFormat(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
  return formatter.format(new Date(Date.UTC(year, month - 1, day)))
}

/** "September 2026", for the calendar heading. */
export function formatMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)))
}
