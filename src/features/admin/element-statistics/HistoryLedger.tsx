import {
  Button, Chip, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TablePagination, TableRow, TextField, Typography,
} from '@mui/material'
import type {
  ElementFilters, ElementJob, ElementJobResult, ElementReport,
} from '../../../../lib/contracts/elementStatistics.ts'
import { duration, grams, instant, length, resultLabels } from './format.ts'

const resultColors: Record<ElementJobResult, 'success' | 'warning' | 'info' | 'default'> = {
  completed: 'success', failed_or_aborted: 'warning', active: 'info', unknown: 'default',
}

interface Props {
  report: ElementReport
  onJob(job: ElementJob): void
  onPage(page: number, pageSize: number): void
  onSort(sort: ElementFilters['sort']): void
}

export default function HistoryLedger({ report, onJob, onPage, onSort }: Props) {
  const { jobs, filters, connections } = report
  return (
    <Paper component="section" aria-labelledby="element-history-heading" sx={{ p: 2, minWidth: 0 }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
          <Typography id="element-history-heading" variant="h2" component="h3">
            Job history ({jobs.total})
          </Typography>
          <TextField select size="small" label="Sort jobs" value={filters.sort}
            sx={{ minWidth: 200 }} onChange={event => {
              const sort = event.target.value
              if (sort === 'started_desc' || sort === 'started_asc' || sort === 'weight_desc' || sort === 'duration_desc') onSort(sort)
            }}>
            <MenuItem value="started_desc">Newest first</MenuItem>
            <MenuItem value="started_asc">Oldest first</MenuItem>
            <MenuItem value="weight_desc">Largest slice estimate</MenuItem>
            <MenuItem value="duration_desc">Longest elapsed runtime</MenuItem>
          </TextField>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Start dates in {filters.timeZone}. Filament and sliced time are estimates for the entire
          job, including failed or aborted jobs. Select a job for reported materials and source details.
        </Typography>
        <TableContainer tabIndex={0} aria-label="Recorded job history">
          <Table size="small" sx={{ minWidth: 800 }}>
            <TableHead><TableRow>
              <TableCell>Started</TableCell><TableCell>Job / printer</TableCell><TableCell>Result</TableCell>
              <TableCell>Runtime / slice estimate</TableCell><TableCell>Filament estimate</TableCell>
              <TableCell>Materials</TableCell>
            </TableRow></TableHead>
            <TableBody>{jobs.items.map(job => {
              const printer = connections.find(item => item.id === job.connectionId)
              const materialNames = [...new Set(job.materials.map(item => item.material ?? 'Unreported'))]
              return (
                <TableRow key={`${job.connectionId}/${job.id}`} hover>
                  <TableCell>{instant(job.startedAt, filters.timeZone)}</TableCell>
                  <TableCell sx={{ maxWidth: 250, overflowWrap: 'anywhere' }}>
                    <Button size="small" onClick={() => onJob(job)} sx={{ textAlign: 'left', justifyContent: 'flex-start' }}>
                      {job.title ?? `Untitled job ${job.id}`}
                    </Button>
                    <Typography variant="body2" color="text.secondary">
                      {printer?.printerName ?? 'Recorded printer'}
                    </Typography>
                  </TableCell>
                  <TableCell><Chip size="small" variant="outlined" color={resultColors[job.result]}
                    label={resultLabels[job.result]} /></TableCell>
                  <TableCell>
                    {duration(job.actualDurationSeconds)} elapsed
                    <Typography variant="body2" color="text.secondary">{duration(job.estimatedDurationSeconds)} sliced</Typography>
                  </TableCell>
                  <TableCell>{grams(job.estimatedWeightGrams)}
                    <Typography variant="body2" color="text.secondary">{length(job)}</Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 160, overflowWrap: 'anywhere' }}>
                    {materialNames.length ? materialNames.join(', ') : 'Unavailable'}
                  </TableCell>
                </TableRow>
              )
            })}</TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={jobs.total} page={jobs.page}
          rowsPerPage={jobs.pageSize} rowsPerPageOptions={[10, 25, 50, 100]}
          onPageChange={(_event, page) => onPage(page, jobs.pageSize)}
          onRowsPerPageChange={event => onPage(0, Number(event.target.value))}
          sx={{ '.MuiTablePagination-toolbar': { flexWrap: 'wrap', px: 0 }, '.MuiTablePagination-spacer': { display: 'none' } }} />
      </Stack>
    </Paper>
  )
}
