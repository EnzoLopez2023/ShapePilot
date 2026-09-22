// One colour of one line, as a reel you can pick up.
//
// The tile is the whole control: it opens the colour's sheet, where the spool
// and refill ticks live. What it shows is only what you scan a shelf for --
// the reel, its name, whether you own it, and whether it is in the AMS -- so a
// line of sixty colours reads as a shelf rather than as a form.
import { Box, ButtonBase, Typography } from '@mui/material'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import type { FilamentColor, FilamentLine, FilamentVariant } from '../../../../lib/contracts/bambuFilaments.ts'
import type { ColorStock } from '../../../../lib/contracts/filamentStock.ts'
import type { FilamentUsageTotals } from '../../../../lib/contracts/filamentUsage.ts'
import { SpoolArt } from './SpoolArt.tsx'
import { trayName } from '../model/ams.ts'
import { formatGrams } from '../model/usage.ts'
import { EASE_IOS } from '../../../theme/theme.ts'
import { ownedSummary } from '../model/shelf.ts'

export interface ColorTileProps {
  line: FilamentLine
  color: FilamentColor
  /** How many of each form the inventory holds; 0 is not owned. */
  quantities: Readonly<Record<FilamentVariant, number>>
  stock?: ColorStock
  usage?: FilamentUsageTotals
  onOpen: () => void
}

export default function ColorTile({
  line, color, quantities, stock, usage, onOpen,
}: ColorTileProps) {
  const owned = ownedSummary(line, quantities)
  // A refill-only shelf draws its reel as a refill: the picture is of what you have.
  const drawn: FilamentVariant = quantities.spool === 0 && quantities.refill > 0 ? 'refill' : 'spool'
  const percent = stock?.lowestPercent ?? null
  const trays = stock?.loaded.map(trayName).join(', ')
  const reorder = stock?.status === 'reorder'
  const code = color.code ? ` ${color.code}` : ''
  // Every tile names itself in full, including what a sighted person reads off
  // the badge and the tray tag: "Jade White" alone would say nothing of which
  // line it is in, or that you own two of it.
  const spoken = [
    `${line.label} ${color.name}${code}`,
    owned ? `owned: ${owned}` : 'not owned',
    trays && `in ${trays}${percent !== null ? `, ${percent}%` : ''}${reorder ? ', reorder' : ''}`,
    usage?.grams ? `${formatGrams(usage.grams)} used` : null,
    color.discontinued && 'discontinued',
  ].filter(Boolean).join(', ')

  return (
    <ButtonBase
      onClick={onOpen}
      aria-label={spoken}
      aria-haspopup="dialog"
      data-state={stock ? 'loaded' : usage?.grams ? 'used' : undefined}
      data-owned={owned ? 'true' : undefined}
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'flex-start',
        textAlign: 'left',
        gap: 0.75,
        p: 1.25,
        pt: 1.5,
        minWidth: 0,
        borderRadius: '14px',
        border: '1px solid',
        borderColor: owned ? 'transparent' : 'divider',
        // Owned sits on the neutral selected wash, not the accent: the badge
        // already carries the accent, and a shelf of blue tiles would shout.
        bgcolor: owned ? 'action.selected' : 'background.paper',
        transition: `background-color 0.2s ${EASE_IOS}, border-color 0.2s ${EASE_IOS}`,
        '&:hover': { bgcolor: 'action.hover' },
        '& .tile-reel': { transition: `transform 0.35s ${EASE_IOS}` },
        '@media (hover: hover) and (prefers-reduced-motion: no-preference)': {
          '&:hover .tile-reel': { transform: 'translateY(-2px) rotate(-4deg)' },
        },
      }}
    >
      {/* Top row: the tray tag the printer would print, and the owned mark. */}
      <Box
        sx={{
          display: 'flex', justifyContent: 'center', alignItems: 'center', height: 64,
          position: 'relative',
        }}
      >
        <Box className="tile-reel">
          <SpoolArt
            hexes={color.hexes}
            variant={drawn}
            size={60}
            faded={color.discontinued}
          />
        </Box>
        {trays && (
          <Box
            aria-hidden
            sx={{
              position: 'absolute', top: -6, left: -4,
              px: 0.75, height: 20, display: 'flex', alignItems: 'center',
              borderRadius: '10px',
              bgcolor: reorder ? 'warning.main' : 'text.primary',
              color: 'background.paper',
              fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.02em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {trays}
          </Box>
        )}
        {owned && (
          <Box
            aria-hidden
            sx={{
              position: 'absolute', top: -6, right: -4,
              width: 22, height: 22, borderRadius: '50%',
              display: 'grid', placeItems: 'center',
              bgcolor: 'primary.main', color: 'primary.contrastText',
              // A ring of the tile's own ground, so the badge sits clear of a
              // flange it overlaps rather than merging into it.
              border: '2px solid', borderColor: 'background.paper',
              '@media (prefers-reduced-motion: no-preference)': {
                animation: `tile-owned 0.32s ${EASE_IOS}`,
              },
              '@keyframes tile-owned': {
                from: { transform: 'scale(0.4)', opacity: 0 },
                to: { transform: 'scale(1)', opacity: 1 },
              },
            }}
          >
            <CheckRoundedIcon sx={{ fontSize: 16 }} />
          </Box>
        )}
      </Box>

      <Box sx={{ minWidth: 0 }}>
        {/* Never tinted with its own hex: half the catalogue would fall
            through the contrast floor. Colour lives in the reel. */}
        <Typography
          variant="body2"
          sx={{
            fontWeight: owned || stock || usage?.grams ? 650 : 500,
            lineHeight: 1.3,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', overflowWrap: 'anywhere',
          }}
        >
          {color.name}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums', mt: 0.25 }}
        >
          {color.discontinued ? <><span>{color.code}</span> · <i>discontinued</i></> : color.code}
        </Typography>
      </Box>

      {/* The Handy library bar: the reel's own colour, as long as what is left. */}
      {stock && (
        <Box aria-hidden sx={{ mt: 'auto' }}>
          <Box
            sx={{
              height: 4, borderRadius: 2, bgcolor: 'divider', overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                height: '100%',
                width: `${percent ?? 100}%`,
                opacity: percent === null ? 0.45 : 1,
                background: color.hexes.length > 1
                  ? `linear-gradient(90deg, ${color.hexes[0]}, ${color.hexes[1]})`
                  : color.hexes[0],
                borderRadius: 2,
              }}
            />
          </Box>
          <Typography
            variant="body2"
            sx={{
              fontSize: '0.75rem', mt: 0.5, fontVariantNumeric: 'tabular-nums',
              color: reorder ? 'warning.main' : 'text.secondary',
              fontWeight: reorder ? 650 : undefined,
            }}
          >
            {percent === null ? 'Loaded' : `${percent}% left`}{reorder && ' · reorder'}
          </Typography>
        </Box>
      )}
      {!stock && (owned || usage?.grams) && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontSize: '0.75rem', mt: 'auto', fontVariantNumeric: 'tabular-nums' }}
        >
          {[owned && owned.replace(/ \+ /g, ' · '), usage?.grams && `${formatGrams(usage.grams)} used`]
            .filter(Boolean).join(' · ')}
        </Typography>
      )}
    </ButtonBase>
  )
}
