// The set read back as a breakdown, and how much of it already has a home.
//
// The inventory is edited as line items; this is the same data read the way a
// person thinks about it -- 1u x 35, 1.25u x 5 -- with the project's trays
// joined in beside it. Everything here is derived: model/summary.ts owns the
// arithmetic and this only draws it.
import { Box, LinearProgress, Stack, Tooltip, Typography } from '@mui/material'
import type { CoverageRow, SetItem } from '../model/types.ts'
import { setTotals, sizeLabel, sizeRows } from '../model/summary.ts'

export interface SetSummaryProps {
  items: SetItem[]
  coverage: CoverageRow[]
}

export default function SetSummary({ items, coverage }: SetSummaryProps) {
  const rows = sizeRows(items, coverage)
  const totals = setTotals(rows, items)

  if (!rows.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        Add caps below, or read them off a photo, and the breakdown appears here.
      </Typography>
    )
  }

  const placedPercent = totals.caps ? Math.round((totals.placed / totals.caps) * 100) : 0

  return (
    <Stack spacing={1.25}>
      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          {totals.caps} {totals.caps === 1 ? 'cap' : 'caps'} in {totals.entries}{' '}
          {totals.entries === 1 ? 'row' : 'rows'}
          {' · '}{totals.placed} placed{totals.remaining > 0 && ` · ${totals.remaining} left`}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={placedPercent}
          aria-label={`${placedPercent}% of the set has a pocket`}
          // MUI tints the track with the accent, which reads as a filled bar
          // at a glance -- an empty set would look half placed. The track is
          // neutral so the only accent on it is real progress.
          sx={{
            height: 6,
            borderRadius: 3,
            bgcolor: 'action.hover',
          }}
        />
      </Box>

      <Box
        component="ul"
        aria-label="Breakdown by size"
        sx={{
          listStyle: 'none', m: 0, p: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
          gap: 0.75,
        }}
      >
        {rows.map(row => (
          <Box
            key={row.key}
            component="li"
            sx={{
              border: 1, borderColor: 'divider', borderRadius: 2,
              px: 1, py: 0.75, minWidth: 0,
            }}
          >
            <Typography variant="h3" component="p">
              {sizeLabel(row.units, row.heightUnits, row.shape)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {row.owned} owned · {Math.min(row.placed, row.owned)} placed
            </Typography>
            {row.remaining > 0 && (
              <Typography variant="body2">{row.remaining} still to place</Typography>
            )}
            {row.overflow > 0 && (
              // A pocket with no cap behind it is worth saying out loud: either
              // the tray is for a set this project no longer describes, or the
              // inventory is short a row.
              <Tooltip title="These trays have more pockets this size than the set has caps.">
                <Typography variant="body2" color="warning.main">
                  {row.overflow} spare {row.overflow === 1 ? 'pocket' : 'pockets'}
                </Typography>
              </Tooltip>
            )}
          </Box>
        ))}
      </Box>
    </Stack>
  )
}
