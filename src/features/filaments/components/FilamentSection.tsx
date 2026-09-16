// One product line, as rows of colours you either own or do not.
//
// A section per line rather than one grid keyed on colour name, because the
// names barely overlap: PLA Matte shares none of PLA Basic's names, and PLA
// Wood shares none with anything. A union grid would have been ~85 rows with a
// single live checkbox each and six dead cells.
//
// The checkbox columns are fixed-width and the name takes what is left, so the
// two-checkbox lines and the one-checkbox lines line up down the page and the
// row never needs to scroll sideways.
import { useState } from 'react'
import {
  Box, Button, Checkbox, IconButton, Paper, Popover, Stack, Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import type { FilamentColor, FilamentLine, FilamentVariant } from '../../../../lib/contracts/bambuFilaments.ts'
import { MAX_QUANTITY, tickId } from '../model/types.ts'
import type { Inventory } from '../model/types.ts'

export interface FilamentSectionProps {
  line: FilamentLine
  colors: readonly FilamentColor[]
  owned: Inventory
  /** Set the count for one filament in one form; 0 removes the tick. */
  onQuantity: (key: string, variant: FilamentVariant, quantity: number) => void
}

const VARIANT_LABEL: Record<FilamentVariant, string> = {
  spool: 'With spool',
  refill: 'Refill',
}

/** What one of each form is called when counting them. */
const VARIANT_NOUN: Record<FilamentVariant, readonly [string, string]> = {
  spool: ['spool', 'spools'],
  refill: ['refill', 'refills'],
}

const countOf = (variant: FilamentVariant, quantity: number): string =>
  `${quantity} ${VARIANT_NOUN[variant][quantity === 1 ? 0 : 1]}`

/** The stepper that is open, and what it is stepping. */
interface Stepping {
  anchor: HTMLElement
  key: string
  variant: FilamentVariant
  /** The row's full spoken name, reused as the stepper's own label. */
  name: string
}

/** Spoken form, for the checkbox's accessible name. */
const VARIANT_SPOKEN: Record<FilamentVariant, string> = {
  spool: 'with spool',
  refill: 'refill',
}

// Narrower at xs so the colour name -- the thing you actually read the row by
// -- keeps a usable share of a 375px screen.
// Wide enough for the checkbox and, once ticked, the count beside it.
const CHECKBOX_COLUMN = { xs: '76px', sm: '104px' } as const

const columnsFor = (variants: readonly FilamentVariant[]) => ({
  xs: `minmax(0, 1fr) ${variants.map(() => CHECKBOX_COLUMN.xs).join(' ')}`,
  sm: `minmax(0, 1fr) ${variants.map(() => CHECKBOX_COLUMN.sm).join(' ')}`,
})

/**
 * The colour, as a dot rather than a squircle -- a 14px radius on an 18px chip
 * is a circle anyway, so it is drawn as one deliberately. The ring is
 * structural, not decoration: Jade White is `#FFFFFF` on a white surface and
 * several of the darks are near-black on the dark ground, so without it those
 * swatches simply are not there. A dual-colour filament is drawn as a split.
 */
function Swatch({ hexes, discontinued }: { hexes: readonly string[]; discontinued?: true }) {
  const background = hexes.length > 1
    ? `linear-gradient(135deg, ${hexes[0]} 0 50%, ${hexes[1]} 50% 100%)`
    : hexes[0]
  return (
    <Box
      aria-hidden
      sx={{
        width: 18,
        height: 18,
        flexShrink: 0,
        borderRadius: '50%',
        background,
        border: '1px solid',
        borderColor: 'divider',
        opacity: discontinued ? 0.55 : 1,
      }}
    />
  )
}

export default function FilamentSection({
  line, colors, owned, onQuantity,
}: FilamentSectionProps) {
  const [stepping, setStepping] = useState<Stepping | null>(null)
  const steppingCount = stepping
    ? owned.get(tickId(stepping.key, stepping.variant)) ?? 0
    : 0
  const ownedCount = colors.reduce((total, color) => total + line.variants.reduce(
    (n, variant) => n + (owned.has(tickId(color.key, variant)) ? 1 : 0), 0), 0)
  const total = colors.length * line.variants.length
  const columns = columnsFor(line.variants)

  return (
    <Paper component="section" aria-labelledby={`line-${line.material}-${line.type}`} sx={{ p: 2 }}>
      <Stack
        direction="row"
        sx={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 2, mb: 1.5 }}
      >
        <Typography variant="h2" component="h2" id={`line-${line.material}-${line.type}`}>
          {line.label}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {ownedCount} of {total}
        </Typography>
      </Stack>

      {/* Column headings. Not a <th>: the row is a grid, and each checkbox
          carries its own full accessible name rather than leaning on a header
          association a grid cannot express. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: columns,
          gap: 1,
          alignItems: 'center',
          pb: 0.75,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box />
        {line.variants.map(variant => (
          <Typography
            key={variant}
            variant="body2"
            color="text.secondary"
            aria-hidden
            sx={{ textAlign: 'center' }}
          >
            {VARIANT_LABEL[variant]}
          </Typography>
        ))}
      </Box>

      {colors.map(color => (
        <Box
          key={color.key}
          sx={{
            display: 'grid',
            gridTemplateColumns: columns,
            gap: 1,
            alignItems: 'center',
            minHeight: 40,
            borderBottom: '1px solid',
            borderColor: 'divider',
            '&:last-of-type': { borderBottom: 'none' },
          }}
        >
          {/* The name is what you read the row by, so it is never the thing
              that gets squeezed. At xs the code and the discontinued note drop
              to a second line rather than ellipsing the name away to "B..". */}
          <Stack
            direction="row"
            sx={{ alignItems: 'center', gap: 1, minWidth: 0, py: 0.5 }}
          >
            <Swatch hexes={color.hexes} discontinued={color.discontinued} />
            <Box
              sx={{
                minWidth: 0,
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                alignItems: { xs: 'flex-start', sm: 'baseline' },
                columnGap: 1,
              }}
            >
              {/* Never tinted with its own hex: half the catalogue would fall
                  through the contrast floor. */}
              <Typography variant="body2">{color.name}</Typography>
              <Stack direction="row" sx={{ gap: 1, alignItems: 'baseline' }}>
                {color.code && (
                  <Typography variant="body2" color="text.secondary">{color.code}</Typography>
                )}
                {color.discontinued && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ fontStyle: 'italic' }}
                  >
                    discontinued
                  </Typography>
                )}
              </Stack>
            </Box>
          </Stack>

          {line.variants.map(variant => {
            // Every control names itself in full. A column heading cannot
            // name a grid cell, and 193 checkboxes called "checkbox" is not a
            // page anyone can use by ear.
            const name = `${line.label} ${color.name}`
              + `${color.code ? ` ${color.code}` : ''}, ${VARIANT_SPOKEN[variant]}`
            const quantity = owned.get(tickId(color.key, variant)) ?? 0
            return (
              <Box
                key={variant}
                sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
              >
                <Checkbox
                  size="small"
                  checked={quantity > 0}
                  onChange={event => onQuantity(color.key, variant, event.target.checked ? 1 : 0)}
                  slotProps={{ input: { 'aria-label': name } }}
                  sx={{ p: 0.75 }}
                />
                {/* Shown on every owned tick, including a count of one, so the
                    way to say "I have two of these" is always visible rather
                    than hidden behind a long-press nobody would find. */}
                {quantity > 0 && (
                  <Button
                    size="small"
                    onClick={event => setStepping({
                      anchor: event.currentTarget, key: color.key, variant, name,
                    })}
                    aria-label={`${name}: ${countOf(variant, quantity)}. Change how many`}
                    aria-haspopup="dialog"
                    sx={{
                      minWidth: 0,
                      px: 0.5,
                      py: 0,
                      fontSize: '0.75rem',
                      fontVariantNumeric: 'tabular-nums',
                      color: quantity > 1 ? 'text.primary' : 'text.secondary',
                      fontWeight: quantity > 1 ? 650 : 400,
                    }}
                  >
                    ×{quantity}
                  </Button>
                )}
              </Box>
            )
          })}
        </Box>
      ))}

      <Popover
        open={stepping !== null && steppingCount > 0}
        anchorEl={stepping?.anchor}
        onClose={() => setStepping(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-label': stepping ? `How many: ${stepping.name}` : undefined,
            sx: { p: 1.5, borderRadius: '14px' },
          },
        }}
      >
        {stepping && (
          <Stack spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 220, textAlign: 'center' }}>
              {stepping.name}
            </Typography>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
              {/* Stops at one. Going to none is unticking the box, which is a
                  different decision and already has its own control. */}
              <IconButton
                size="small"
                aria-label="One fewer"
                disabled={steppingCount <= 1}
                onClick={() => onQuantity(stepping.key, stepping.variant, steppingCount - 1)}
              >
                <RemoveRoundedIcon fontSize="small" />
              </IconButton>
              <Typography
                aria-live="polite"
                sx={{
                  minWidth: 72, textAlign: 'center', fontWeight: 650,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {countOf(stepping.variant, steppingCount)}
              </Typography>
              <IconButton
                size="small"
                aria-label="One more"
                disabled={steppingCount >= MAX_QUANTITY}
                onClick={() => onQuantity(stepping.key, stepping.variant, steppingCount + 1)}
              >
                <AddRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Stack>
        )}
      </Popover>
    </Paper>
  )
}
