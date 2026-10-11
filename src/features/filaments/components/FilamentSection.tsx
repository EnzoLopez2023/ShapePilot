// One product line, as a shelf of reels.
//
// A section per line rather than one grid keyed on colour name, because the
// names barely overlap: PLA Matte shares none of PLA Basic's names, and PLA
// Wood shares none with anything.
//
// Each colour is a tile that opens its sheet. The grid fills the width it has,
// so a phone gets three reels to a row and a desk gets seven, and nothing ever
// scrolls sideways. Colours arrive already ordered: on hand first, the most
// printed of those first.
import { Box, Paper, Stack, Typography } from '@mui/material'
import type { FilamentColor, FilamentLine } from '../../../../lib/contracts/bambuFilaments.ts'
import type { ColorStock } from '../../../../lib/contracts/filamentStock.ts'
import type { ColorLedger } from '../../../../lib/contracts/filamentOrders.ts'
import ColorTile from './ColorTile.tsx'
import { rollsLabel } from '../model/shelf.ts'

export interface FilamentSectionProps {
  id: string
  line: FilamentLine
  colors: readonly FilamentColor[]
  /** Bought and printed, by colour key. */
  ledgers: ReadonlyMap<string, ColorLedger>
  /** Colours loaded in the AMS, by key. Absent when this account cannot see it. */
  stock?: ReadonlyMap<string, ColorStock>
  onOpen: (key: string) => void
}

export default function FilamentSection({
  id, line, colors, ledgers, stock, onOpen,
}: FilamentSectionProps) {
  const headingId = `line-${line.material}-${line.type}`
  const ownedColors = colors.filter(color => (ledgers.get(color.key)?.rollsOnHand ?? 0) > 0).length
  const rolls = colors.reduce((sum, color) => sum + (ledgers.get(color.key)?.rollsOnHand ?? 0), 0)

  return (
    <Paper component="section" aria-labelledby={headingId} data-line={id} sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Stack
        direction="row"
        sx={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 2, mb: 1.5, flexWrap: 'wrap' }}
      >
        <Typography variant="h2" component="h2" id={headingId}>
          {line.label}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {ownedColors > 0 && (
            <>
              <Box component="span" sx={{ color: 'text.primary', fontWeight: 650 }}>{rollsLabel(rolls)}</Box>
              {' '}in {ownedColors} {ownedColors === 1 ? 'colour' : 'colours'} ·{' '}
            </>
          )}
          {colors.length} listed
        </Typography>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(auto-fill, minmax(96px, 1fr))',
            sm: 'repeat(auto-fill, minmax(116px, 1fr))',
          },
          gap: { xs: 1, sm: 1.25 },
        }}
      >
        {colors.map(color => (
          <ColorTile
            key={color.key}
            line={line}
            color={color}
            ledger={ledgers.get(color.key)}
            stock={stock?.get(color.key)}
            onOpen={() => onOpen(color.key)}
          />
        ))}
      </Box>
    </Paper>
  )
}
