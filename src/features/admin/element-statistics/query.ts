import type {
  ElementFilters, ElementGrain, ElementJobResult, ElementQuery,
} from '../../../../lib/contracts/elementStatistics.ts'
import { presetDates } from './format.ts'

const results: readonly (ElementJobResult | 'all')[] =
  ['all', 'completed', 'failed_or_aborted', 'active', 'unknown']
const grains: readonly ElementGrain[] = ['day', 'week', 'month']
const sorts: readonly ElementFilters['sort'][] =
  ['started_desc', 'started_asc', 'weight_desc', 'duration_desc']
const ranges = ['7', '30', '90', 'month', 'year', 'all', 'custom']

export function initialElementQuery(params: URLSearchParams, timeZone: string): {
  query: ElementQuery; range: string; error: string | null
} {
  const zone = params.get('timeZone') ?? timeZone
  let validZone = true
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format() } catch { validZone = false }
  const safeZone = validZone ? zone : 'UTC'
  const explicitDates = params.has('from') || params.has('to')
  const requestedRange = params.get('range') ?? (explicitDates ? 'custom' : '30')
  const validRange = ranges.includes(requestedRange)
  let range = validRange ? requestedRange : '30'
  const dates = explicitDates || range === 'custom'
    ? { from: params.get('from'), to: params.get('to') }
    : presetDates(range, safeZone)
  if (explicitDates && range !== 'custom') {
    const current = presetDates(range, safeZone)
    // Shared report URLs preserve their explicit dates. A saved relative
    // preset becomes a custom range once its dates are no longer relative.
    if (current.from !== dates.from || current.to !== dates.to) range = 'custom'
  }
  const result = results.find(value => value === (params.get('result') ?? 'all'))
  const grain = grains.find(value => value === (params.get('grain') ?? 'day'))
  const sort = sorts.find(value => value === (params.get('sort') ?? 'started_desc'))
  const page = Number(params.get('page') ?? '0')
  const pageSize = Number(params.get('pageSize') ?? '25')
  const validPage = Number.isInteger(page) && page >= 0
  const validSize = [10, 25, 50, 100].includes(pageSize)
  const repeated = [...params.keys()].some(key => params.getAll(key).length > 1)
  const invalid = !validZone || !validRange || !result || !grain || !sort || !validPage
    || !validSize || repeated || (range === 'custom' && !dates.from && !dates.to)
  return {
    range,
    query: {
      filters: {
        ...dates, timeZone: safeZone, result: result ?? 'all', grain: grain ?? 'day',
        sort: sort ?? 'started_desc', connectionId: params.get('connectionId'),
        material: params.get('material'), search: params.get('search') ?? '',
      },
      page: validPage ? page : 0, pageSize: validSize ? pageSize : 25,
    },
    error: invalid ? 'This link contains unsupported filters. Reset the filters to continue.' : null,
  }
}

export function elementSearch(query: ElementQuery, range: string): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query.filters)) {
    if (value !== null && value !== '') params.set(key, value)
  }
  params.set('range', range)
  params.set('page', String(query.page))
  params.set('pageSize', String(query.pageSize))
  return params
}
