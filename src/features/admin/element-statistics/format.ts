import type {
  ElementJobInput, ElementJobResult, ElementMeasure,
} from '../../../../lib/contracts/elementStatistics.ts'

export const resultLabels: Record<ElementJobResult, string> = {
  completed: 'Completed',
  failed_or_aborted: 'Failed or aborted',
  active: 'Active',
  unknown: 'Unknown',
}

export const number = (value: number | null, digits = 1): string =>
  value === null ? 'Unavailable' : new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
  }).format(value)

export const grams = (value: number | null): string =>
  value === null ? 'Unavailable' : `${number(value)} g`

export function duration(seconds: number | null): string {
  if (seconds === null) return 'Unavailable'
  if (seconds < 60) return `${number(seconds, 0)} sec`
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
}

export function length(job: Pick<ElementJobInput, 'estimatedLength' | 'lengthUnit'>): string {
  if (job.estimatedLength === null) return 'Unavailable'
  return `${number(job.estimatedLength)} ${job.lengthUnit ?? '(unit unreported)'}`
}

export const instant = (value: string | null, timeZone: string): string =>
  value === null ? 'Unavailable' : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short', timeZone,
  }).format(new Date(value))

export const measureCoverage = (value: ElementMeasure): string =>
  `${value.known} reported${value.missing > 0 ? `; ${value.missing} unavailable` : ''}`

export function calendarDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const part = (type: string) => parts.find(item => item.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function presetDates(preset: string, timeZone: string, now = new Date()): {
  from: string | null; to: string | null
} {
  if (preset === 'all') return { from: null, to: null }
  const to = calendarDate(now, timeZone)
  if (preset === 'month') return { from: `${to.slice(0, 7)}-01`, to }
  if (preset === 'year') return { from: `${to.slice(0, 4)}-01-01`, to }
  const day = new Date(`${to}T12:00:00Z`)
  day.setUTCDate(day.getUTCDate() - Number(preset) + 1)
  return { from: day.toISOString().slice(0, 10), to }
}
