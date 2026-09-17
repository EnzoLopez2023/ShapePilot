// How long the printer has actually been printing, as far as the recorded
// history goes.
//
// Useful beside a date-based schedule -- a filter is worn by hours of printing,
// not by the calendar -- but it is not an odometer: it counts the cloud jobs
// ShapePilot has recorded, which begin when the connection was configured and
// exclude anything printed offline or from an SD card. It is shown as that.
import { useEffect, useState } from 'react'
import { Box, Link, Paper, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import type { ElementReport } from '../../../../lib/contracts/elementStatistics.ts'
import { getElementReport } from '../../admin/element-statistics/service.ts'
import { initialElementQuery } from '../../admin/element-statistics/query.ts'

const hours = (seconds: number): string =>
  seconds >= 360_000
    ? `${Math.round(seconds / 3600).toLocaleString()} hours`
    : `${(seconds / 3600).toFixed(1)} hours`

export default function RecordedRuntime() {
  const [report, setReport] = useState<ElementReport | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    // Every recorded job, not a date window: this is a lifetime-ish figure.
    const { query } = initialElementQuery(new URLSearchParams('range=all'), timeZone)
    void getElementReport(query, controller.signal)
      .then(value => setReport(value))
      // Not an administrator, or no history yet: the panel simply does not appear.
      .catch(() => { /* nothing to show */ })
    return () => controller.abort()
  }, [])

  const runtime = report?.totals.actualDurationSeconds
  if (!report || !runtime || runtime.value === null || report.totals.jobs === 0) return null

  return (
    <Paper variant="outlined" sx={{ borderRadius: '14px', p: { xs: 1.5, sm: 2 } }}>
      <Typography component="h2" sx={{ fontWeight: 650, fontSize: '1rem', mb: 0.5 }}>
        Recorded printing time
      </Typography>
      <Typography variant="body2" color="text.secondary">
        <Box component="span" sx={{ fontWeight: 650 }}>{hours(runtime.value)}</Box>
        {' '}across {report.totals.jobs.toLocaleString()} recorded jobs
        {runtime.missing > 0 && <> ({runtime.missing} without a usable start and end)</>}
        . From{' '}
        <Link component={RouterLink} to="/admin/el-ement-statistics">EL-ement Statistics</Link>
        , which holds cloud jobs since the connection was set up — not an odometer, and not
        anything printed offline.
      </Typography>
    </Paper>
  )
}
