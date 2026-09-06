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
import { Box, Checkbox, Paper, Stack, Typography } from '@mui/material'
import type { FilamentColor, FilamentLine, FilamentVariant } from '../../../../lib/contracts/bambuFilaments.ts'
import { tickId } from '../model/types.ts'

export interface FilamentSectionProps {
  line: FilamentLine
  colors: readonly FilamentColor[]
  owned: ReadonlySet<string>
  onToggle: (key: string, variant: FilamentVariant, next: boolean) => void
}

const VARIANT_LABEL: Record<FilamentVariant, string> = {
  spool: 'With spool',
  refill: 'Refill',
}

/** Spoken form, for the checkbox's accessible name. */
const VARIANT_SPOKEN: Record<FilamentVariant, string> = {
  spool: 'with spool',
  refill: 'refill',
}

// Narrower at xs so the colour name -- the thing you actually read the row by
// -- keeps a usable share of a 375px screen.
const CHECKBOX_COLUMN = { xs: '64px', sm: '96px' } as const

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
  line, colors, owned, onToggle,
}: FilamentSectionProps) {
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

          {line.variants.map(variant => (
            <Box key={variant} sx={{ display: 'flex', justifyContent: 'center' }}>
              <Checkbox
                size="small"
                checked={owned.has(tickId(color.key, variant))}
                onChange={event => onToggle(color.key, variant, event.target.checked)}
                slotProps={{
                  input: {
                    // Every checkbox names itself in full. A column heading
                    // cannot name a grid cell, and 165 checkboxes called
                    // "checkbox" is not a page anyone can use by ear.
                    'aria-label': `${line.label} ${color.name}`
                      + `${color.code ? ` ${color.code}` : ''}, ${VARIANT_SPOKEN[variant]}`,
                  },
                }}
              />
            </Box>
          ))}
        </Box>
      ))}
    </Paper>
  )
}
