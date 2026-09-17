import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, Menu, MenuItem, Paper, Skeleton, Stack, Typography,
} from '@mui/material'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import SyncRoundedIcon from '@mui/icons-material/SyncRounded'
import { useSearchParams } from 'react-router-dom'
import type {
  ElementFilters, ElementJob, ElementQuery, ElementReport, ElementStatus,
} from '../../../../lib/contracts/elementStatistics.ts'
import { errorMessage } from '../../../services/errors.ts'
import { ErrorState } from '../../../components/LoadingState.tsx'
import ConnectionPanel from './ConnectionPanel.tsx'
import LiveStatus from './LiveStatus.tsx'
import StatisticsFilters from './StatisticsFilters.tsx'
import StatisticsCharts from './StatisticsCharts.tsx'
import HistoryLedger from './HistoryLedger.tsx'
import JobDetail from './JobDetail.tsx'
import CoveragePanel from './CoveragePanel.tsx'
import { initialElementQuery, elementSearch } from './query.ts'
import { presetDates } from './format.ts'
import {
  elementQueryString, exportElementCsv, exportElementPrintable, getElementReport,
  getElementStatus, syncElementHistory,
} from './service.ts'

function StatisticsLoading({ label }: { label: string }) {
  return (
    <Paper role="status" aria-label={label} sx={{ p: 2 }}>
      <Typography variant="body2" sx={{ mb: 1 }}>{label}</Typography>
      <Skeleton variant="text" width="45%" />
      <Skeleton variant="rounded" height={96} animation={false} />
    </Paper>
  )
}

export default function ElementStatisticsPage() {
  const [params, setParams] = useSearchParams()
  const search = params.toString()
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const parsed = useMemo(() => initialElementQuery(new URLSearchParams(search), timeZone), [search, timeZone])
  const query = parsed.query
  const requestKey = elementQueryString(query)
  const range = parsed.range
  const [status, setStatus] = useState<ElementStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [statusRevision, setStatusRevision] = useState(0)
  const [reportState, setReportState] = useState<{ key: string; report: ElementReport } | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const [reportRevision, setReportRevision] = useState(0)
  const [setupExpanded, setSetupExpanded] = useState(false)
  const [setupTouched, setSetupTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null)
  const setupRef = useRef<HTMLDivElement>(null)
  const urls = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  // The report stays on screen while the next scope loads, even though it is
  // the previous scope's: swapping it for a skeleton shortens the page, and a
  // shorter page throws away where the reader was -- which is exactly what
  // clicking a chart bar should preserve.
  const report = reportState?.report ?? null
  const stale = reportState !== null && reportState.key !== requestKey
  const syncRevision = status?.coverage.map(item =>
    `${item.connectionId}:${item.jobCount}:${item.sync.lastSuccessAt ?? ''}`,
  ).join('|') ?? ''

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let controller: AbortController | null = null
    const load = async () => {
      if (timer) clearTimeout(timer)
      controller?.abort()
      const current = new AbortController()
      controller = current
      let delay = 15_000
      try {
        const value = await getElementStatus(current.signal)
        if (!disposed && !current.signal.aborted) {
          setStatus(value)
          setStatusError(null)
          delay = value.syncing ? 5000 : 15_000
        }
      } catch (reason) {
        if (!disposed && !current.signal.aborted) {
          setStatusError(errorMessage(reason))
          setStatus(null)
        }
      } finally {
        if (!disposed && controller === current) {
          timer = setTimeout(() => {
            if (document.visibilityState === 'visible') void load()
          }, delay)
        }
      }
    }
    const visible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', visible)
    void load()
    return () => {
      disposed = true
      controller?.abort()
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [statusRevision])

  useEffect(() => {
    if (parsed.error) return
    const controller = new AbortController()
    setReportError(null)
    void getElementReport(query, controller.signal).then(value => {
      if (!controller.signal.aborted) setReportState({ key: requestKey, report: value })
    }).catch(reason => {
      if (!controller.signal.aborted) {
        setReportError(errorMessage(reason))
        setReportState(null)
      }
    })
    return () => controller.abort()
  }, [query, requestKey, parsed.error, syncRevision, reportRevision])

  useEffect(() => {
    const handles = urls.current
    return () => {
      for (const [url, timer] of handles) {
        clearTimeout(timer)
        URL.revokeObjectURL(url)
      }
      handles.clear()
    }
  }, [])

  const objectUrl = (blob: Blob) => {
    const url = URL.createObjectURL(blob)
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url)
      urls.current.delete(url)
    }, 60_000)
    urls.current.set(url, timer)
    return url
  }
  const update = (next: ElementQuery, nextRange = range) => setParams(elementSearch(next, nextRange))
  const applyFilters = (filters: ElementFilters, nextRange = range) => update({ ...query, filters, page: 0 }, nextRange)
  const reset = () => applyFilters({
    ...query.filters, ...presetDates('30', timeZone), timeZone, connectionId: null,
    material: null, result: 'all', search: '', grain: 'day', sort: 'started_desc',
  }, '30')
  const changed = () => setStatusRevision(value => value + 1)
  const sync = async (rescan: boolean) => {
    setBusy(true)
    setActionError(null)
    setActionMessage(null)
    try {
      const result = await syncElementHistory(rescan)
      setActionMessage(result.started
        ? 'History sync requested. Imported records will appear automatically as pages are saved.'
        : 'A history sync is already running.')
      changed()
    } catch (reason) {
      setActionError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }
  const exportReport = async (kind: 'jobs' | 'materials' | 'summary' | 'print') => {
    setExportAnchor(null)
    setActionError(null)
    let preview: Window | null = null
    if (kind === 'print') {
      preview = window.open('about:blank', '_blank')
      if (!preview) {
        setActionError('Allow a new tab for this site to open the printable report.')
        return
      }
      preview.opener = null
      preview.document.title = 'EL-ement Statistics report'
      preview.document.body.textContent = 'Preparing the authenticated report...'
    }
    setBusy(true)
    try {
      const blob = kind === 'print' ? await exportElementPrintable(query) : await exportElementCsv(query, kind)
      const url = objectUrl(blob)
      if (preview) {
        preview.location.href = url
        setActionMessage('Printable report opened in a new tab. Use the browser Print command to print or save as PDF.')
      } else {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `el-ement-statistics-${kind}.csv`
        document.body.append(anchor)
        anchor.click()
        anchor.remove()
      }
    } catch (reason) {
      preview?.close()
      setActionError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }
  const openJob = (job: ElementJob) => {
    const next = new URLSearchParams(params)
    next.set('jobConnection', job.connectionId)
    next.set('job', job.id)
    setParams(next)
  }
  const closeJob = () => {
    const next = new URLSearchParams(params)
    next.delete('jobConnection')
    next.delete('job')
    setParams(next)
  }
  const canSync = status?.settings.enabled && status.credential.configured
    && status.connectionState !== 'expired' && status.connectionState !== 'selection_required'
  const jobId = params.get('job')
  const jobConnection = params.get('jobConnection')
  const totalRecorded = status?.coverage.reduce((sum, item) => sum + item.jobCount, 0) ?? 0

  return (
    <Stack spacing={2} sx={{ minWidth: 0, pb: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="h2" component="h2">EL-ement Statistics</Typography>
          <Typography variant="body2" color="text.secondary">
            Household printer status, recorded history and scoped reports.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<SyncRoundedIcon />}
            disabled={!canSync || busy || status?.syncing} onClick={() => void sync(false)}>
            {status?.syncing ? 'Syncing history...' : 'Sync history'}
          </Button>
          <Button variant="outlined" startIcon={<DownloadRoundedIcon />} disabled={!report || busy}
            aria-haspopup="menu" aria-expanded={Boolean(exportAnchor)} aria-controls={exportAnchor ? 'element-export-menu' : undefined}
            onClick={event => setExportAnchor(event.currentTarget)}>
            Export
          </Button>
          <Menu id="element-export-menu" anchorEl={exportAnchor} open={Boolean(exportAnchor)}
            onClose={() => setExportAnchor(null)}>
            <MenuItem onClick={() => void exportReport('jobs')}>Jobs CSV</MenuItem>
            <MenuItem onClick={() => void exportReport('materials')}>Materials CSV</MenuItem>
            <MenuItem onClick={() => void exportReport('summary')}>Summary CSV</MenuItem>
            <MenuItem onClick={() => void exportReport('print')}>Open printable report</MenuItem>
          </Menu>
        </Stack>
      </Stack>
      {actionError && <Alert severity="error" onClose={() => setActionError(null)}>{actionError}</Alert>}
      {actionMessage && <Alert severity="info" onClose={() => setActionMessage(null)}>{actionMessage}</Alert>}
      {statusError && <ErrorState message={statusError} onRetry={changed} />}
      {!status && !statusError && <StatisticsLoading label="Loading printer connection and recording status..." />}
      {status && <>
        <LiveStatus status={status} onSetup={() => {
          setSetupExpanded(true)
          setSetupTouched(true)
          setupRef.current?.scrollIntoView({ block: 'nearest' })
        }} />
        <Box ref={setupRef}>
          <ConnectionPanel status={status} expanded={setupTouched ? setupExpanded : !status.settings.enabled}
            onExpanded={value => { setSetupTouched(true); setSetupExpanded(value) }} onChanged={changed} />
        </Box>
        {status.problem && status.settings.enabled && <Alert severity="warning">{status.problem.message}</Alert>}
      </>}
      <StatisticsFilters key={`${requestKey}:${range}`} filters={query.filters} range={range}
        connections={status?.connections ?? []} materials={report?.availableMaterials ?? reportState?.report.availableMaterials ?? []}
        onApply={applyFilters} onReset={reset} />
      {parsed.error ? <Alert severity="error" action={<Button onClick={reset}>Reset filters</Button>}>{parsed.error}</Alert>
        : reportError ? <ErrorState message={reportError} onRetry={() => setReportRevision(value => value + 1)} />
          : !report ? <StatisticsLoading label="Reading the filtered job ledger..." />
            : report.jobs.total === 0 ? (
              <Paper sx={{ p: 3 }}>
                <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <Typography variant="h2" component="h3">{totalRecorded > 0 ? 'No jobs match this scope' : 'No recorded jobs yet'}</Typography>
                  <Typography color="text.secondary" sx={{ maxWidth: '70ch' }}>
                    {totalRecorded > 0
                      ? 'Try a wider date range, another printer connection or fewer filters. Previously imported jobs have not been deleted.'
                      : 'Configure and enable the household printer connection to import available Bambu cloud history. Recording continues on the server when this page is closed.'}
                  </Typography>
                  {totalRecorded > 0 && <Button onClick={reset}>Reset filters</Button>}
                </Stack>
              </Paper>
            ) : (
              <Stack spacing={2} aria-busy={stale || undefined} sx={{ opacity: stale ? 0.6 : 1 }}>
                <StatisticsCharts report={report} status={status} onBucket={bucket => {
                  if (bucket.from && bucket.to) applyFilters({ ...query.filters, from: bucket.from, to: bucket.to }, 'custom')
                }} onMaterial={material => applyFilters({ ...query.filters, material: material ?? '__unreported__' })} />
                <HistoryLedger report={report} onJob={openJob}
                  onPage={(page, pageSize) => update({ ...query, page, pageSize })}
                  onSort={sort => applyFilters({ ...query.filters, sort })} />
              </Stack>
            )}
      {status && <CoveragePanel status={status} report={report} busy={busy} onRescan={() => void sync(true)} />}
      {jobId && jobConnection && <JobDetail connectionId={jobConnection} jobId={jobId}
        timeZone={query.filters.timeZone} onClose={closeJob} />}
    </Stack>
  )
}
