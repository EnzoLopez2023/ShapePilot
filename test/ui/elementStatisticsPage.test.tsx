// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type {
  ElementFilters, ElementMeasure, ElementReport, ElementStatus, ElementTotals,
} from '../../lib/contracts/elementStatistics.ts'
import {
  ELEMENT_TEST_NOW, syntheticElementAccount, syntheticElementConnection,
  syntheticElementSnapshot, syntheticElementSyncState, syntheticRecordedElementJob,
} from '../fixtures/elementStatistics.ts'
import AdminPage from '../../src/features/admin/AdminPage.tsx'
import { buildTheme } from '../../src/theme/theme.ts'
import { SHIPPED_DESIGNER_DEFAULTS } from '../../src/features/settings/preferences.ts'

let role: 'admin' | 'user'
let offline: boolean
let configured: boolean
let enabled: boolean
let empty: boolean
let partial: boolean
let calls: { path: string; method: string; body: unknown }[]

const baseJobs = [
  syntheticRecordedElementJob(),
  syntheticRecordedElementJob({
    id: '899', title: 'Synthetic interrupted bracket', result: 'failed_or_aborted', rawStatus: '3',
    actualDurationSeconds: 600, estimatedWeightGrams: 100,
    materials: [{
      material: 'PETG', filamentId: null, color: null, estimatedWeightGrams: 100,
      nozzleId: null, amsId: null, slotId: null,
    }],
  }),
]
const measure = (values: (number | null)[]): ElementMeasure => ({
  value: values.some(value => value !== null)
    ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null,
  known: values.filter(value => value !== null).length,
  missing: values.filter(value => value === null).length,
})
const sync = syntheticElementSyncState
const coverage = () => [{
  connectionId: syntheticElementConnection.id, jobCount: empty ? 0 : 2,
  earliestJobAt: empty ? null : baseJobs[0].startedAt, latestJobAt: empty ? null : baseJobs[0].startedAt,
  firstRecordedAt: empty ? null : ELEMENT_TEST_NOW, lastRecordedAt: empty ? null : ELEMENT_TEST_NOW,
  undatedJobs: 0, sync: partial ? {
    ...sync, backfillComplete: false,
    problem: { code: 'synthetic_gap', message: 'Synthetic history import is paused; retry after the cooldown.' },
  } : sync,
}]

function status(): ElementStatus {
  return {
    settings: { enabled, activeConnectionId: configured ? syntheticElementConnection.id : null, updatedAt: ELEMENT_TEST_NOW },
    credential: { configured, region: 'global', expiresAt: null },
    connectionState: !configured ? 'unconfigured' : enabled ? 'connected' : 'disabled',
    problem: configured ? null : { code: 'credential_missing', message: 'Configure SHAPEPILOT_BAMBU_ACCESS_TOKEN in the server secret store, then restart ShapePilot and verify.' },
    connections: configured ? [syntheticElementConnection] : [],
    snapshot: configured && enabled ? syntheticElementSnapshot : null,
    snapshotConnectionId: configured ? syntheticElementConnection.id : null,
    freshness: configured && enabled ? 'fresh' : 'unavailable', syncing: false,
    coverage: configured ? coverage() : [], events: [], checkedAt: ELEMENT_TEST_NOW,
  }
}

function report(params: URLSearchParams): ElementReport {
  const filters: ElementFilters = {
    from: params.get('from'), to: params.get('to'), timeZone: params.get('timeZone') ?? 'UTC',
    result: params.get('result') === 'failed_or_aborted' ? 'failed_or_aborted' : 'all',
    search: params.get('search') ?? '', connectionId: params.get('connectionId'),
    material: params.get('material'), grain: 'day', sort: 'started_desc',
  }
  const jobs = (empty ? [] : baseJobs).filter(job =>
    (filters.result === 'all' || job.result === filters.result)
    && job.title?.toLowerCase().includes(filters.search.toLowerCase())
    && (!filters.material || job.materials.some(material => material.material === filters.material)))
  const totals: ElementTotals = {
    jobs: jobs.length,
    results: {
      completed: jobs.filter(job => job.result === 'completed').length,
      failed_or_aborted: jobs.filter(job => job.result === 'failed_or_aborted').length, active: 0, unknown: 0,
    },
    actualDurationSeconds: measure(jobs.map(job => job.actualDurationSeconds)),
    estimatedDurationSeconds: measure(jobs.map(job => job.estimatedDurationSeconds)),
    completedWeightGrams: measure(jobs.filter(job => job.result === 'completed').map(job => job.estimatedWeightGrams)),
    failedOrAbortedWeightGrams: measure(jobs.filter(job => job.result === 'failed_or_aborted').map(job => job.estimatedWeightGrams)),
    otherWeightGrams: measure([]), estimatedLengthMeters: measure(jobs.map(() => null)),
    unreportedLengthUnitJobs: jobs.length, unreportedMaterialJobs: 0, undatedJobs: 0,
  }
  return {
    generatedAt: ELEMENT_TEST_NOW, filters, totals,
    trend: [{ key: '2026-09-14', from: '2026-09-14', to: '2026-09-14', totals }],
    materials: ['PLA', 'PETG'].filter(material => jobs.some(job => job.materials.some(item => item.material === material)))
      .map(material => ({
        material, jobs: 1,
        results: {
          completed: jobs.filter(job => job.result === 'completed' && job.materials[0].material === material).length,
          failed_or_aborted: jobs.filter(job => job.result === 'failed_or_aborted' && job.materials[0].material === material).length,
          active: 0, unknown: 0,
        },
        completedWeightGrams: measure(jobs.filter(job => job.result === 'completed' && job.materials[0].material === material).map(job => job.estimatedWeightGrams)),
        failedOrAbortedWeightGrams: measure(jobs.filter(job => job.result === 'failed_or_aborted' && job.materials[0].material === material).map(job => job.estimatedWeightGrams)),
        otherWeightGrams: measure([]),
      })),
    materialWeightDiscrepancyJobs: 0, connections: [syntheticElementConnection],
    availableMaterials: ['PLA', 'PETG'], coverage: coverage(),
    assumptions: ['Synthetic test fixture; no real account history.'],
    jobs: { items: jobs, total: jobs.length, page: Number(params.get('page') ?? 0), pageSize: Number(params.get('pageSize') ?? 25) },
  }
}

const json = (body: unknown, code = 200) => new Response(JSON.stringify(body), {
  status: code, headers: { 'content-type': 'application/json' },
})

function Location() {
  const location = useLocation()
  return <output aria-label="Current route">{location.pathname}{location.search}</output>
}

const renderPage = (path = '/admin/el-ement-statistics?range=all&timeZone=UTC', mode: 'light' | 'dark' = 'light') => render(
  <ThemeProvider theme={buildTheme(mode)}>
    <CssBaseline />
    <MemoryRouter initialEntries={[path]}>
      <Location />
      <Routes><Route path="/admin/*" element={<AdminPage />} /></Routes>
    </MemoryRouter>
  </ThemeProvider>,
)

/** What the account has saved; a recorded print is matched back to it by name. */
let savedDesigns: unknown[] = []

beforeEach(() => {
  savedDesigns = []
  role = 'admin'
  offline = false
  configured = true
  enabled = true
  empty = false
  partial = false
  calls = []
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 270))
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://synthetic.invalid')
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    calls.push({ path: url.pathname + url.search, method, body })
    if (url.pathname === '/api/settings') return json({
      profile: { tenantId: 'synthetic', oid: 'synthetic', displayName: 'Synthetic admin', role, authSource: 'development', email: null },
      preferences: { themeMode: 'light', units: 'mm', reducedMotion: 'system', designerDefaults: SHIPPED_DESIGNER_DEFAULTS },
    })
    if (offline) return json({ error: { code: 'unavailable', message: 'Synthetic API outage. Retry when the server is reachable.' } }, 503)
    if (url.pathname.endsWith('/status')) return json(status())
    if (url.pathname.endsWith('/report')) return json(report(url.searchParams))
    if (url.pathname.includes('/jobs/')) return json({
      job: baseJobs.find(job => url.pathname.endsWith(`/${job.id}`)), connection: syntheticElementConnection, events: [],
    })
    if (url.pathname === '/api/design-documents') return json(savedDesigns)
    if (url.pathname.endsWith('/discover')) return json(syntheticElementAccount)
    if (url.pathname.endsWith('/connection')) {
      enabled = body?.enabled === true
      return json(status())
    }
    if (url.pathname.endsWith('/sync')) return json({ started: true }, 202)
    if (url.pathname.endsWith('.csv')) return new Response('Synthetic report CSV', { headers: { 'content-type': 'text/csv' } })
    return json({ error: { code: 'not_found', message: 'Unexpected synthetic request.' } }, 404)
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('deep-linked Admin tab is discoverable and renders live metrics, real charts and recorded job detail', async () => {
  const user = userEvent.setup()
  renderPage()
  expect((await screen.findByRole('tab', { name: 'EL-ement Statistics' })).getAttribute('href')).toBe('/admin/el-ement-statistics')
  expect(screen.getByRole('tab', { name: 'Service overview' }).getAttribute('href')).toBe('/admin')
  await screen.findByRole('heading', { name: 'Job history (2)' })
  expect(screen.getByText(/42%/)).toBeTruthy()
  expect(screen.getByText(/215.*220/)).toBeTruthy()
  expect(screen.getByLabelText('Print counts by start date and result')).toBeTruthy()
  expect(screen.getByLabelText('Full-job estimated filament grams over time')).toBeTruthy()
  expect(screen.getByLabelText('Recorded runtime and sliced time estimates in hours')).toBeTruthy()
  expect(screen.getByLabelText('Full-job filament estimates by material')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Synthetic calibration plate' }))
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByText('Reported material mapping')
  expect(screen.getByLabelText('Current route').textContent).toContain('job=900')
  expect(within(dialog).getByText(/Raw result: 2/)).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Close job details' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('non-admins never mount or request statistics even through its direct URL', async () => {
  role = 'user'
  renderPage()
  await screen.findByText('Administrator access is required to open Admin.')
  expect(calls.every(call => call.path === '/api/settings')).toBe(true)
  expect(screen.queryByRole('tab', { name: 'EL-ement Statistics' })).toBeNull()
})

test('disclosures reference a single unique region rather than duplicate IDs', async () => {
  renderPage()
  await screen.findByRole('heading', { name: 'Job history (2)' })
  for (const id of ['element-connection-body', 'element-coverage-body', 'element-chart-data']) {
    expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1)
    expect(document.getElementById(id)?.getAttribute('role')).toBe('region')
  }
})

test('unconfigured state gives server-only setup instructions without fabricated history or a credential form', async () => {
  configured = false
  enabled = false
  empty = true
  renderPage()
  await screen.findByRole('heading', { name: 'No recorded jobs yet' })
  expect(screen.getAllByText(/SHAPEPILOT_BAMBU_ACCESS_TOKEN/).length).toBeGreaterThan(0)
  expect(screen.getByText('SHAPEPILOT_BAMBU_REGION')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Verify connection' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.queryByLabelText(/password|access token/i)).toBeNull()
  expect(screen.queryByLabelText('Print counts by start date and result')).toBeNull()
  expect(screen.getByText(/No live report has been received/)).toBeTruthy()
})

test('filters update the URL, chart totals and ledger from the same request scope', async () => {
  const user = userEvent.setup()
  renderPage()
  await screen.findByRole('heading', { name: 'Job history (2)' })
  await user.click(screen.getByRole('combobox', { name: 'Job result' }))
  await user.click(screen.getByRole('option', { name: 'Failed or aborted' }))
  await user.click(screen.getByRole('button', { name: 'Apply filters' }))
  await screen.findByRole('heading', { name: 'Job history (1)' })
  expect(screen.queryByRole('button', { name: 'Synthetic calibration plate' })).toBeNull()
  expect(screen.getByLabelText('Current route').textContent).toContain('result=failed_or_aborted')
  expect(calls.some(call => call.path.includes('/report?') && call.path.includes('result=failed_or_aborted'))).toBe(true)
  const activity = screen.getByRole('heading', { name: 'Recorded activity' }).closest('section')!
  expect(within(activity).getByText('1 jobs')).toBeTruthy()
  expect(within(activity).getByText('100 g')).toBeTruthy()
})

test('partial backfill and sync problems are visible beside totals without opening coverage details', async () => {
  partial = true
  renderPage()
  const heading = await screen.findByRole('heading', { name: 'Recorded activity' })
  const activity = within(heading.closest('section')!)
  expect(activity.getByText(/Backfill incomplete; totals cover imported jobs only/)).toBeTruthy()
  expect(activity.getByText('Synthetic history import is paused; retry after the cooldown.')).toBeTruthy()
  expect(activity.getByText(/Last successful sync/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Coverage, sync and reporting assumptions' }).getAttribute('aria-expanded')).toBe('false')
})

test('numeric chart equivalents provide keyboard-operable interval and material drilldown', async () => {
  const user = userEvent.setup()
  renderPage()
  await screen.findByRole('heading', { name: 'Job history (2)' })
  await user.click(screen.getByRole('button', { name: 'Chart data and material breakdown' }))
  await user.click(screen.getByRole('button', { name: 'Show jobs starting 2026-09-14' }))
  await waitFor(() => expect(screen.getByLabelText('Current route').textContent).toContain('from=2026-09-14'))
  expect(screen.getByLabelText('Current route').textContent).toContain('to=2026-09-14')
  expect(screen.getByLabelText('Current route').textContent).toContain('range=custom')
  await screen.findByRole('heading', { name: 'Job history (2)' })
  const chartButton = screen.getByRole('button', { name: 'Chart data and material breakdown' })
  if (chartButton.getAttribute('aria-expanded') !== 'true') await user.click(chartButton)
  await user.click(screen.getByRole('button', { name: 'Show jobs containing PETG' }))
  await screen.findByRole('heading', { name: 'Job history (1)' })
  expect(screen.getByLabelText('Current route').textContent).toContain('material=PETG')
})

test('verification and disabling monitoring are actionable and do not request tokens from the browser', async () => {
  const user = userEvent.setup()
  enabled = false
  renderPage()
  await screen.findByRole('button', { name: 'Verify connection' })
  await user.click(screen.getByRole('button', { name: 'Verify connection' }))
  await screen.findByRole('combobox', { name: 'Verified household printer' })
  await user.click(screen.getByRole('button', { name: 'Enable monitoring' }))
  await screen.findByText(/Monitoring is enabled/)
  await waitFor(() => expect(
    screen.getByRole('button', { name: 'Household printer connection' }).getAttribute('aria-expanded'),
  ).toBe('true'))
  const saved = calls.find(call => call.path.endsWith('/connection'))
  expect(saved?.body).toEqual({
    enabled: true, accountId: syntheticElementAccount.accountId, printerId: 'SYNTHETIC123',
  })
  await user.click(await screen.findByRole('button', { name: 'Disable monitoring' }))
  await screen.findByText(/Previously recorded jobs and reports are retained/)
  expect(screen.getByRole('heading', { name: 'Job history (2)' })).toBeTruthy()
})

test('custom range validation and API errors remain explicit in dark mode', async () => {
  const user = userEvent.setup()
  renderPage('/admin/el-ement-statistics?range=all&timeZone=UTC', 'dark')
  await screen.findByRole('heading', { name: 'Job history (2)' })
  await user.clear(screen.getByLabelText('Time zone'))
  await user.type(screen.getByLabelText('Time zone'), 'invalid-zone')
  await user.click(screen.getByRole('button', { name: 'Apply filters' }))
  await screen.findByText(/Enter a valid IANA time zone/)
  offline = true
  await user.click(screen.getByRole('button', { name: 'Sync history' }))
  await screen.findByText('Synthetic API outage. Retry when the server is reachable.')
  expect(screen.queryByText(/History sync requested/)).toBeNull()
})

test('CSV downloads use the current filters and include more than the visible-page concept', async () => {
  const user = userEvent.setup()
  const create = vi.fn(() => 'blob:synthetic-export')
  vi.stubGlobal('URL', class extends URL {
    static override createObjectURL = create
    static override revokeObjectURL = vi.fn()
  })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  renderPage('/admin/el-ement-statistics?range=all&timeZone=UTC&result=failed_or_aborted')
  await screen.findByRole('heading', { name: 'Job history (1)' })
  await user.click(screen.getByRole('button', { name: 'Export' }))
  await user.click(screen.getByRole('menuitem', { name: 'Jobs CSV' }))
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  expect(click).toHaveBeenCalled()
  expect(calls.some(call => call.path.includes('/export/jobs.csv?') && call.path.includes('result=failed_or_aborted'))).toBe(true)
})

test('an edited scope says it is not applied until Apply is pressed', async () => {
  const user = userEvent.setup()
  renderPage()
  await screen.findByRole('heading', { name: 'Job history (2)' })
  // Nothing edited: the button has nothing to do, and says so.
  expect(screen.getByRole('button', { name: 'Filters applied' }).hasAttribute('disabled')).toBe(true)
  expect(screen.queryByText('Not applied yet')).toBeNull()

  await user.click(screen.getByRole('combobox', { name: 'Job result' }))
  await user.click(screen.getByRole('option', { name: 'Failed or aborted' }))

  // A chart click applies at once, so an edited form must not look applied.
  await screen.findByText('Not applied yet')
  expect(screen.getByText('These changes are not in the charts or the ledger yet.')).toBeTruthy()
  await screen.findByRole('heading', { name: 'Job history (2)' })

  await user.click(screen.getByRole('button', { name: 'Apply filters' }))

  await screen.findByRole('heading', { name: 'Job history (1)' })
  await waitFor(() => expect(screen.queryByText('Not applied yet')).toBeNull())
})

test('a recorded job links back to the design whose name it carries', async () => {
  savedDesigns = [{
    id: 'design-7', kind: 'bambu', name: 'Synthetic calibration plate', objectCount: 3,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  }]
  const user = userEvent.setup()
  renderPage()
  await screen.findByRole('heading', { name: 'Job history (2)' })

  await user.click(screen.getByRole('button', { name: 'Synthetic calibration plate' }))

  const dialog = within(await screen.findByRole('dialog'))
  await waitFor(() => expect(dialog.getByRole('link', { name: 'Open design' })).toBeTruthy())
  expect(dialog.getByRole('link', { name: 'Open design' }).getAttribute('href'))
    .toBe('/bambu-designer?open=design-7')
  // The claim is a name match, and says so rather than asserting provenance.
  expect(dialog.getByText(/Names are all there is to go on/)).toBeTruthy()
})

test('a job whose name matches nothing offers no design link', async () => {
  savedDesigns = [{
    id: 'design-9', kind: 'bambu', name: 'Something else entirely', objectCount: 1,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  }]
  const user = userEvent.setup()
  renderPage()
  await screen.findByRole('heading', { name: 'Job history (2)' })

  await user.click(screen.getByRole('button', { name: 'Synthetic calibration plate' }))

  const dialog = within(await screen.findByRole('dialog'))
  await dialog.findByText(/Reported material mapping/)
  expect(dialog.queryByRole('link', { name: 'Open design' })).toBeNull()
})
