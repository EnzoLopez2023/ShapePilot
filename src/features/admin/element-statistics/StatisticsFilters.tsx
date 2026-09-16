import { useState } from 'react'
import type { FormEvent } from 'react'
import { Alert, Box, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import type { ElementConnection, ElementFilters } from '../../../../lib/contracts/elementStatistics.ts'
import { presetDates, resultLabels } from './format.ts'

interface Props {
  filters: ElementFilters
  range: string
  connections: ElementConnection[]
  materials: string[]
  onApply(filters: ElementFilters, range: string): void
  onReset(): void
}

export default function StatisticsFilters({ filters, range, connections, materials, onApply, onReset }: Props) {
  const [draft, setDraft] = useState(filters)
  const [preset, setPreset] = useState(range)
  const [error, setError] = useState<string | null>(null)
  const change = (values: Partial<ElementFilters>) => setDraft(previous => ({ ...previous, ...values }))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    try {
      new Intl.DateTimeFormat('en', { timeZone: draft.timeZone }).format()
    } catch {
      setError('Enter a valid IANA time zone, such as America/New_York or UTC.')
      return
    }
    const dates = preset === 'custom'
      ? { from: draft.from, to: draft.to } : presetDates(preset, draft.timeZone)
    if (preset === 'custom' && (!dates.from || !dates.to)) {
      setError('Choose both the first and last date for a custom range.')
      return
    }
    if (dates.from && dates.to && dates.from > dates.to) {
      setError('The first date must be on or before the last date.')
      return
    }
    setError(null)
    onApply({ ...draft, ...dates }, preset)
  }
  return (
    <Paper component="section" aria-labelledby="statistics-filters-heading" sx={{ p: 2 }}>
      <Stack component="form" onSubmit={submit} spacing={2}>
        <Typography id="statistics-filters-heading" variant="h2" component="h3">History scope</Typography>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' } }}>
          <TextField select size="small" label="Date range" value={preset}
            onChange={event => setPreset(event.target.value)}>
            <MenuItem value="7">Last 7 days</MenuItem>
            <MenuItem value="30">Last 30 days</MenuItem>
            <MenuItem value="90">Last 90 days</MenuItem>
            <MenuItem value="month">This month</MenuItem>
            <MenuItem value="year">This year</MenuItem>
            <MenuItem value="all">All recorded history</MenuItem>
            <MenuItem value="custom">Custom range</MenuItem>
          </TextField>
          <TextField select size="small" label="Printer connection" value={draft.connectionId ?? ''}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            onChange={event => change({ connectionId: event.target.value || null })}>
            <MenuItem value="">All recorded connections</MenuItem>
            {connections.map(connection => (
              <MenuItem key={connection.id} value={connection.id}>
                {connection.printerName} / {connection.accountName ?? connection.accountId}
              </MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label="Material in job" value={draft.material ?? ''}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            onChange={event => change({ material: event.target.value || null })}>
            <MenuItem value="">All materials</MenuItem>
            {materials.filter(material => material !== '__unreported__').map(material =>
              <MenuItem key={material} value={material}>{material}</MenuItem>)}
            <MenuItem value="__unreported__">Unreported material</MenuItem>
          </TextField>
          <TextField select size="small" label="Job result" value={draft.result}
            onChange={event => {
              const result = event.target.value
              if (result === 'all' || result === 'completed' || result === 'failed_or_aborted'
                || result === 'active' || result === 'unknown') change({ result })
            }}>
            <MenuItem value="all">All results</MenuItem>
            {Object.entries(resultLabels).map(([value, label]) =>
              <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </TextField>
          {preset === 'custom' && <>
            <TextField size="small" type="date" label="First date" value={draft.from ?? ''}
              slotProps={{ inputLabel: { shrink: true } }}
              onChange={event => change({ from: event.target.value || null })} required />
            <TextField size="small" type="date" label="Last date" value={draft.to ?? ''}
              slotProps={{ inputLabel: { shrink: true } }}
              onChange={event => change({ to: event.target.value || null })} required />
          </>}
          <TextField size="small" label="Time zone" value={draft.timeZone}
            helperText="IANA name; dates are inclusive."
            onChange={event => change({ timeZone: event.target.value })} />
          <TextField select size="small" label="Chart interval" value={draft.grain}
            onChange={event => {
              const grain = event.target.value
              if (grain === 'day' || grain === 'week' || grain === 'month') change({ grain })
            }}>
            <MenuItem value="day">Day</MenuItem>
            <MenuItem value="week">Week (Monday start)</MenuItem>
            <MenuItem value="month">Month</MenuItem>
          </TextField>
          <TextField size="small" label="Search jobs" value={draft.search}
            slotProps={{ htmlInput: { maxLength: 150 } }}
            onChange={event => change({ search: event.target.value })} sx={{ gridColumn: { sm: 'span 2' } }} />
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Button type="submit" variant="contained">Apply filters</Button>
          <Button onClick={onReset}>Reset filters</Button>
          <Typography variant="body2" color="text.secondary">
            One scope for charts, jobs and exports. Material filters select whole jobs.
          </Typography>
        </Stack>
      </Stack>
    </Paper>
  )
}
