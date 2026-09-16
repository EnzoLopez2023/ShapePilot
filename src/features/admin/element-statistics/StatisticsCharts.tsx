import {
  Accordion, AccordionDetails, AccordionSummary, Box, Button, Paper, Stack, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import { BarChart } from '@mui/x-charts/BarChart'
import { LineChart } from '@mui/x-charts/LineChart'
import type {
  ElementMeasure, ElementReport, ElementStatus, ElementTrendBucket,
} from '../../../../lib/contracts/elementStatistics.ts'
import { duration, grams, instant, measureCoverage, number } from './format.ts'

function RecordingStatus({ report, status }: { report: ElementReport; status: ElementStatus | null }) {
  const coverage = (status?.coverage ?? report.coverage)
    .filter(item => !report.filters.connectionId || item.connectionId === report.filters.connectionId)
  return (
    <Stack spacing={0.75} aria-label="History recording status">
      <Typography variant="h3" component="h4">Recording status (connection-wide)</Typography>
      {coverage.map(item => {
        const connection = report.connections.find(value => value.id === item.connectionId)
        const monitored = status?.settings.enabled && status.credential.configured
          && status.settings.activeConnectionId === item.connectionId
        const stale = item.sync.lastSuccessAt !== null
          && Date.parse(status?.checkedAt ?? report.generatedAt) - Date.parse(item.sync.lastSuccessAt) > 15 * 60_000
        return (
          <Box key={item.connectionId}>
            <Typography variant="body2" color={!item.sync.backfillComplete || (monitored && stale) ? 'warning.main' : 'text.secondary'}>
              {connection?.printerName ?? 'Recorded printer'}: {item.jobCount} recorded jobs.{' '}
              {item.sync.backfillComplete ? 'Available cloud pages scanned.' : 'Backfill incomplete; totals cover imported jobs only.'}{' '}
              {!monitored ? 'Not currently monitored; retained history.' : stale ? 'History sync is stale.' : ''}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Last successful sync: {instant(item.sync.lastSuccessAt, report.filters.timeZone)} ({report.filters.timeZone}).{' '}
              Recorded start dates: {instant(item.earliestJobAt, report.filters.timeZone)} to {instant(item.latestJobAt, report.filters.timeZone)}.{' '}
              {item.undatedJobs > 0 ? `${item.undatedJobs} jobs have no start date.` : ''}
            </Typography>
            {item.sync.problem && <Typography variant="body2" color="error.main">{item.sync.problem.message}</Typography>}
            {item.sync.remoteTotal !== null && item.sync.remoteTotal > item.jobCount && (
              <Typography variant="body2" color="warning.main">
                The cloud reports {item.sync.remoteTotal} jobs; {item.jobCount} have been recorded.
              </Typography>
            )}
          </Box>
        )
      })}
      <Typography variant="body2" color="text.secondary">
        Coverage describes the connection's recorded ledger before report filters. Cloud retention and local/SD-card coverage are not guaranteed.
      </Typography>
    </Stack>
  )
}

function SummaryMeasure({ label, measure, unit }: {
  label: string; measure: ElementMeasure; unit: 'time' | 'weight'
}) {
  return (
    <Box>
      <Typography component="dt" variant="body2" color="text.secondary">{label}</Typography>
      <Typography component="dd" sx={{ m: 0, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {unit === 'time' ? duration(measure.value) : grams(measure.value)}
      </Typography>
      <Typography variant="body2" color="text.secondary">{measureCoverage(measure)}</Typography>
    </Box>
  )
}

function MeasureCell({ value }: { value: ElementMeasure }) {
  return (
    <TableCell align="right">
      {grams(value.value)}
      {value.missing > 0 && <Typography variant="body2" color="text.secondary">
        {value.missing} unavailable
      </Typography>}
    </TableCell>
  )
}

interface Props {
  report: ElementReport
  status: ElementStatus | null
  onBucket(bucket: ElementTrendBucket): void
  onMaterial(material: string | null): void
}

export default function StatisticsCharts({ report, status, onBucket, onMaterial }: Props) {
  const theme = useTheme()
  const { totals, trend, materials } = report
  const keys = trend.map(bucket => bucket.key)
  const completedColor = theme.palette.success.main
  const failedColor = theme.palette.error.main
  const otherColor = theme.palette.text.secondary
  const chartSx = { minWidth: 0, '& .MuiChartsLegend-root': { flexWrap: 'wrap' } }
  const weightAvailable = totals.completedWeightGrams.known
    + totals.failedOrAbortedWeightGrams.known + totals.otherWeightGrams.known > 0
  const hours = (measure: ElementMeasure) => measure.value === null ? null : measure.value / 3600
  const showBucket = (index: number) => {
    const bucket = trend[index]
    if (bucket && bucket.from !== null && bucket.to !== null) onBucket(bucket)
  }
  return (
    <Stack spacing={2}>
      <Paper component="section" aria-labelledby="element-summary-heading" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography id="element-summary-heading" variant="h2" component="h3">Recorded activity</Typography>
          <RecordingStatus report={report} status={status} />
          <Typography>
            <strong>{number(totals.jobs, 0)} jobs</strong>{' / '}
            {totals.results.completed} completed, {totals.results.failed_or_aborted} failed or aborted,{' '}
            {totals.results.active} active, {totals.results.unknown} unknown.
          </Typography>
          <Box component="dl" sx={{
            m: 0, display: 'grid', gap: 2,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
          }}>
            <SummaryMeasure label="Recorded elapsed runtime" unit="time" measure={totals.actualDurationSeconds} />
            <SummaryMeasure label="Full sliced time estimate" unit="time" measure={totals.estimatedDurationSeconds} />
            <SummaryMeasure label="Completed-job filament estimate" unit="weight" measure={totals.completedWeightGrams} />
            <SummaryMeasure label="Failed / aborted full-job estimate" unit="weight" measure={totals.failedOrAbortedWeightGrams} />
            <SummaryMeasure label="Active / unknown full-job estimate" unit="weight" measure={totals.otherWeightGrams} />
            <Box>
              <Typography component="dt" variant="body2" color="text.secondary">Reporting gaps in this scope</Typography>
              <Typography component="dd" sx={{ m: 0 }}>
                {totals.unreportedMaterialJobs} jobs without material, {totals.undatedJobs} without start dates.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {totals.unreportedLengthUnitJobs} length estimates have unreported units.
              </Typography>
            </Box>
          </Box>
          <Typography variant="body2" color="text.secondary">
            Filament values are full sliced-job estimates, not measured extrusion. A failed or aborted
            print still carries its full estimate. Runtime comes only from valid terminal timestamps.
          </Typography>
        </Stack>
      </Paper>
      <Paper component="section" aria-labelledby="element-trends-heading" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography id="element-trends-heading" variant="h2" component="h3">Trends and materials</Typography>
          <Typography variant="body2" color="text.secondary">
            Jobs are grouped by start date in {report.filters.timeZone}. Select a bar or a chart-data
            row to inspect that interval. Runtime is attributed to the job start, not spread across
            the days the printer was occupied.
          </Typography>
          <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h3" component="h4">Prints by result</Typography>
              <BarChart height={270} skipAnimation aria-label="Print counts by start date and result"
                xAxis={[{ scaleType: 'band', data: keys }]}
                yAxis={[{ min: 0, tickMinStep: 1, label: 'Jobs' }]}
                series={[
                  { id: 'completed', label: 'Completed', data: trend.map(item => item.totals.results.completed), stack: 'jobs', color: completedColor },
                  { id: 'failed', label: 'Failed / aborted', data: trend.map(item => item.totals.results.failed_or_aborted), stack: 'jobs', color: failedColor },
                  { id: 'active', label: 'Active', data: trend.map(item => item.totals.results.active), stack: 'jobs', color: theme.palette.primary.main },
                  { id: 'unknown', label: 'Unknown', data: trend.map(item => item.totals.results.unknown), stack: 'jobs', color: otherColor },
                ]}
                onItemClick={(_event, item) => showBucket(item.dataIndex)}
                grid={{ horizontal: true }} sx={chartSx} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h3" component="h4">Filament estimates</Typography>
              {weightAvailable ? (
                <BarChart height={270} skipAnimation aria-label="Full-job estimated filament grams over time"
                  xAxis={[{ scaleType: 'band', data: keys }]} yAxis={[{ min: 0, label: 'g (estimated)' }]}
                  series={[
                    { id: 'completed', label: 'Completed', data: trend.map(item => item.totals.completedWeightGrams.value), stack: 'grams', color: completedColor, valueFormatter: grams },
                    { id: 'failed', label: 'Failed / aborted', data: trend.map(item => item.totals.failedOrAbortedWeightGrams.value), stack: 'grams', color: failedColor, valueFormatter: grams },
                    { id: 'other', label: 'Active / unknown', data: trend.map(item => item.totals.otherWeightGrams.value), stack: 'grams', color: otherColor, valueFormatter: grams },
                  ]}
                  onItemClick={(_event, item) => showBucket(item.dataIndex)}
                  grid={{ horizontal: true }} sx={chartSx} />
              ) : <Typography color="text.secondary" sx={{ py: 3 }}>No filament weights were reported in this scope.</Typography>}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h3" component="h4">Runtime and sliced time</Typography>
              {totals.actualDurationSeconds.known + totals.estimatedDurationSeconds.known > 0 ? (
                <LineChart height={270} skipAnimation aria-label="Recorded runtime and sliced time estimates in hours"
                  xAxis={[{ scaleType: 'point', data: keys }]} yAxis={[{ min: 0, label: 'Hours' }]}
                  series={[
                    { id: 'runtime', label: 'Elapsed runtime', data: trend.map(item => hours(item.totals.actualDurationSeconds)), color: theme.palette.primary.main, curve: 'linear', valueFormatter: value => `${number(value, 2)} hr` },
                    { id: 'slice', label: 'Slice estimate', data: trend.map(item => hours(item.totals.estimatedDurationSeconds)), color: theme.palette.warning.main, curve: 'linear', valueFormatter: value => `${number(value, 2)} hr` },
                  ]}
                  onMarkClick={(_event, item) => showBucket(item.dataIndex)}
                  grid={{ horizontal: true }} sx={chartSx} />
              ) : <Typography color="text.secondary" sx={{ py: 3 }}>No usable runtime or slice estimates were reported.</Typography>}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h3" component="h4">Material estimates</Typography>
              {materials.some(item => item.completedWeightGrams.known + item.failedOrAbortedWeightGrams.known + item.otherWeightGrams.known > 0) ? (
                <BarChart height={Math.max(270, Math.min(materials.length, 12) * 34 + 90)}
                  skipAnimation layout="horizontal" aria-label="Full-job filament estimates by material"
                  yAxis={[{ scaleType: 'band', data: materials.map(item => item.material ?? 'Unreported'), width: 90 }]}
                  xAxis={[{ min: 0, label: 'g (estimated)' }]}
                  series={[
                    { id: 'completed', label: 'Completed', data: materials.map(item => item.completedWeightGrams.value), stack: 'material', color: completedColor, valueFormatter: grams },
                    { id: 'failed', label: 'Failed / aborted', data: materials.map(item => item.failedOrAbortedWeightGrams.value), stack: 'material', color: failedColor, valueFormatter: grams },
                    { id: 'other', label: 'Active / unknown', data: materials.map(item => item.otherWeightGrams.value), stack: 'material', color: otherColor, valueFormatter: grams },
                  ]}
                  onItemClick={(_event, item) => onMaterial(materials[item.dataIndex].material)}
                  grid={{ vertical: true }} sx={chartSx} />
              ) : <Typography color="text.secondary" sx={{ py: 3 }}>No material weight breakdown is available.</Typography>}
              {report.materialWeightDiscrepancyJobs > 0 && <Typography variant="body2" color="warning.main">
                {report.materialWeightDiscrepancyJobs} jobs have material weights that differ from the whole-job estimate.
                Reported values are preserved, not scaled.
              </Typography>}
            </Box>
          </Box>
          <Accordion disableGutters sx={{ boxShadow: 'none', '&::before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}
              id="element-chart-data-heading" aria-controls="element-chart-data">
              <Typography>Chart data and material breakdown</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  Numeric equivalents of every chart. Unavailable values are not zero; rounding is display-only.
                </Typography>
                <TableContainer tabIndex={0} aria-label="Time series chart data">
                  <Table size="small" sx={{ minWidth: 1050 }}>
                    <TableHead><TableRow>
                      <TableCell>Interval start ({report.filters.timeZone})</TableCell>
                      <TableCell align="right">Completed</TableCell><TableCell align="right">Failed / aborted</TableCell>
                      <TableCell align="right">Active</TableCell><TableCell align="right">Unknown</TableCell>
                      <TableCell align="right">Completed estimate</TableCell><TableCell align="right">Failed / aborted estimate</TableCell>
                      <TableCell align="right">Other estimate</TableCell><TableCell align="right">Runtime</TableCell>
                      <TableCell align="right">Sliced time</TableCell>
                    </TableRow></TableHead>
                    <TableBody>{trend.map(bucket => (
                      <TableRow key={bucket.key}>
                        <TableCell>
                          {bucket.from && bucket.to ? <Button size="small" onClick={() => onBucket(bucket)}
                            aria-label={`Show jobs starting ${bucket.key}`}>{bucket.key}</Button> : bucket.key}
                        </TableCell>
                        <TableCell align="right">{bucket.totals.results.completed}</TableCell>
                        <TableCell align="right">{bucket.totals.results.failed_or_aborted}</TableCell>
                        <TableCell align="right">{bucket.totals.results.active}</TableCell>
                        <TableCell align="right">{bucket.totals.results.unknown}</TableCell>
                        <MeasureCell value={bucket.totals.completedWeightGrams} />
                        <MeasureCell value={bucket.totals.failedOrAbortedWeightGrams} />
                        <MeasureCell value={bucket.totals.otherWeightGrams} />
                        <TableCell align="right">{duration(bucket.totals.actualDurationSeconds.value)}
                          <Typography variant="body2">{measureCoverage(bucket.totals.actualDurationSeconds)}</Typography></TableCell>
                        <TableCell align="right">{duration(bucket.totals.estimatedDurationSeconds.value)}
                          <Typography variant="body2">{measureCoverage(bucket.totals.estimatedDurationSeconds)}</Typography></TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                </TableContainer>
                <TableContainer tabIndex={0} aria-label="Material chart data">
                  <Table size="small" sx={{ minWidth: 640 }}>
                    <TableHead><TableRow>
                      <TableCell>Material</TableCell><TableCell align="right">Jobs</TableCell>
                      <TableCell align="right">Completed estimate</TableCell>
                      <TableCell align="right">Failed / aborted estimate</TableCell>
                      <TableCell align="right">Active / unknown estimate</TableCell>
                    </TableRow></TableHead>
                    <TableBody>{materials.map(item => (
                      <TableRow key={item.material ?? '__unreported__'}>
                        <TableCell><Button size="small" onClick={() => onMaterial(item.material)}
                          aria-label={`Show jobs containing ${item.material ?? 'unreported material'}`}>
                          {item.material ?? 'Unreported material'}
                        </Button></TableCell>
                        <TableCell align="right">{item.jobs}</TableCell>
                        <MeasureCell value={item.completedWeightGrams} />
                        <MeasureCell value={item.failedOrAbortedWeightGrams} />
                        <MeasureCell value={item.otherWeightGrams} />
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                </TableContainer>
              </Stack>
            </AccordionDetails>
          </Accordion>
        </Stack>
      </Paper>
    </Stack>
  )
}
