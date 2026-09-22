// One product line, as a shelf of reels.
//
// A section per line rather than one grid keyed on colour name, because the
// names barely overlap: PLA Matte shares none of PLA Basic's names, and PLA
// Wood shares none with anything.
//
// Each colour is a tile that opens its sheet; the spool and refill ticks live
// there. The grid fills the width it has, so a phone gets three reels to a row
// and a desk gets seven, and nothing ever scrolls sideways.
import { Box, Paper, Stack, Typography } from '@mui/material'
import type { FilamentColor, FilamentLine } from '../../../../lib/contracts/bambuFilaments.ts'
import { tickId } from '../model/types.ts'
import type { Inventory } from '../model/types.ts'
import type { FilamentUsageTotals } from '../../../../lib/contracts/filamentUsage.ts'
import type { ColorStock } from '../../../../lib/contracts/filamentStock.ts'
import { formatMoney } from '../model/cost.ts'
import ColorTile from './ColorTile.tsx'
import { quantitiesOf } from '../model/shelf.ts'

export interface FilamentSectionProps {
  id: string
  line: FilamentLine
  colors: readonly FilamentColor[]
  owned: Inventory
  /** Printed so far, by colour key. Absent when this account cannot see usage. */
  usage?: ReadonlyMap<string, FilamentUsageTotals>
  /** Colours loaded in the AMS, by key. Absent when this account cannot see it. */
  stock?: ReadonlyMap<string, ColorStock>
  pricePerKg: number | null
  currency: string | null
  onOpen: (key: string) => void
}

export default function FilamentSection({
  id, line, colors, owned, usage, stock, pricePerKg, currency, onOpen,
}: FilamentSectionProps) {
  const headingId = `line-${line.material}-${line.type}`
  const ownedColors = colors.filter(color =>
    line.variants.some(variant => owned.has(tickId(color.key, variant)))).length

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
          {ownedColors > 0 && <><Box component="span" sx={{ color: 'text.primary', fontWeight: 650 }}>{ownedColors}</Box> owned · </>}
          {colors.length} {colors.length === 1 ? 'colour' : 'colours'}
          {line.variants.length === 1 && ' · spool only'}
          {pricePerKg !== null && currency && <> · {formatMoney(pricePerKg, currency)}/kg</>}
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
            quantities={quantitiesOf(owned, color.key)}
            stock={stock?.get(color.key)}
            usage={usage?.get(color.key)}
            onOpen={() => onOpen(color.key)}
          />
        ))}
      </Box>
    </Paper>
  )
}
