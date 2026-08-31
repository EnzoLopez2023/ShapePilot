// The set read back as a breakdown, and how much of it already has a home.
//
// The same allocation the designer's panel uses, so the two never disagree: a
// named cap needs a pocket of its own size, and plain 1u caps share whatever
// pocket width is left over -- which is what makes a 10u trough ten homes
// rather than one.
import { Box, LinearProgress, Stack, Tooltip, Typography } from '@mui/material'
import { PYTHON_SIZING } from '../../keycap-tray/geometry/shapes.ts'
import { allocateSet } from '../model/allocation.ts'
import type { PocketShape } from '../model/allocation.ts'
import type { CoverageRow, SetItem } from '../model/types.ts'

export interface SetSummaryProps {
  items: SetItem[]
  coverage: CoverageRow[]
}

/** Coverage rows are counts; allocation wants one entry per pocket. */
const expand = (coverage: readonly CoverageRow[]): PocketShape[] =>
  coverage.flatMap(row => Array.from({ length: row.pockets }, () => ({
    units: row.units,
    heightUnits: row.heightUnits,
    shape: row.shape,
    rotationDeg: row.rotationDeg ?? 0,
  })))

interface Card {
  key: string
  label: string
  owned: number
  placed: number
  left: number
  note?: string
}

export default function SetSummary({ items, coverage }: SetSummaryProps) {
  // A project spans trays that could each carry their own sizing; the default
  // is the reference here, and the difference between presets is a fraction of
  // a millimetre -- far too little to change how many caps fit across a pocket.
  const result = allocateSet(items, expand(coverage), PYTHON_SIZING)

  if (!result.owned) {
    return (
      <Typography variant="body2" color="text.secondary">
        Add caps below, or read them off a photo, and the breakdown appears here.
      </Typography>
    )
  }

  const cards: Card[] = []
  if (result.oneUnit.owned) {
    cards.push({
      key: '1u',
      label: '1u',
      owned: result.oneUnit.owned,
      placed: result.oneUnit.placed,
      left: result.oneUnit.left,
      note: result.oneUnit.spare > 0 ? `${result.oneUnit.spare} spare slots` : undefined,
    })
  }
  for (const row of result.rows) {
    cards.push({
      key: row.key,
      label: row.label,
      owned: row.owned,
      placed: row.placed,
      left: row.left,
    })
  }

  const percent = Math.round((result.placed / result.owned) * 100)

  return (
    <Stack spacing={1.25}>
      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          {result.owned} {result.owned === 1 ? 'cap' : 'caps'}
          {' · '}{result.placed} placed
          {result.left > 0 && ` · ${result.left} to go`}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={percent}
          aria-label={`${percent}% of the set has a pocket`}
          sx={{ height: 6, borderRadius: 3, bgcolor: 'action.hover' }}
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
        {cards.map(card => (
          <Box
            key={card.key}
            component="li"
            sx={{
              border: 1, borderColor: 'divider', borderRadius: 2,
              px: 1, py: 0.75, minWidth: 0,
            }}
          >
            <Typography variant="h3" component="p">{card.label}</Typography>
            <Typography variant="body2" color="text.secondary">
              {card.owned} owned · {card.placed} placed
            </Typography>
            {card.left > 0 && (
              <Typography variant="body2">{card.left} still to place</Typography>
            )}
            {card.note && (
              <Tooltip title="Pocket width left over after every cap that needs its own pocket has one.">
                <Typography variant="body2" color="text.secondary">{card.note}</Typography>
              </Tooltip>
            )}
          </Box>
        ))}
      </Box>
    </Stack>
  )
}
