// Everything about one colour, and the ticks that say you own it.
//
// A bottom sheet on a phone, a dialog on a desk. The ticks moved here from the
// rows: a shelf of sixty colours reads as a shelf when each colour is one
// picture, and the two checkboxes per colour it replaced read as a form. A
// tick is still the commit -- nothing here waits for a Save.
//
// The sheet steps through the colours that were on screen when it opened
// (arrows, or ← and → on a keyboard), so ticking a run of spools is a run of
// taps rather than a run of open-and-close.
import { forwardRef, useEffect } from 'react'
import type { ReactElement, Ref } from 'react'
import {
  Box, Checkbox, Dialog, Fade, IconButton, Slide, Stack, Typography, useMediaQuery,
} from '@mui/material'
import type { TransitionProps } from '@mui/material/transitions'
import { useTheme } from '@mui/material/styles'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import type { FilamentColor, FilamentLine, FilamentVariant } from '../../../../lib/contracts/bambuFilaments.ts'
import type { ColorStock } from '../../../../lib/contracts/filamentStock.ts'
import type { FilamentUsageTotals } from '../../../../lib/contracts/filamentUsage.ts'
import { MAX_QUANTITY } from '../model/types.ts'
import { trayName } from '../model/ams.ts'
import { formatGrams } from '../model/usage.ts'
import { formatMoney } from '../model/cost.ts'
import { SpoolArt } from './SpoolArt.tsx'
import { VARIANT_NOUN, countOf, stockNote, tickName } from '../model/shelf.ts'
import { EASE_IOS } from '../../../theme/theme.ts'

const VARIANT_TITLE: Record<FilamentVariant, string> = {
  spool: 'With spool',
  refill: 'Refill',
}

const VARIANT_NOTE: Record<FilamentVariant, string> = {
  spool: 'On its own reusable reel',
  refill: 'The coil alone, for a reel you keep',
}

export interface SheetEntry {
  line: FilamentLine
  color: FilamentColor
  quantities: Readonly<Record<FilamentVariant, number>>
  stock?: ColorStock
  usage?: FilamentUsageTotals
  pricePerKg: number | null
}

export interface FilamentSheetProps {
  entry: SheetEntry | null
  onClose: () => void
  onQuantity: (key: string, variant: FilamentVariant, quantity: number) => void
  currency: string | null
  /** Where this colour sits in the run the sheet steps through. */
  position: { index: number; total: number }
  onStep: (delta: -1 | 1) => void
}

const SlideUp = forwardRef(function SlideUp(
  props: TransitionProps & { children: ReactElement }, ref: Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} easing={EASE_IOS} />
})

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'warning' }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontWeight: 600, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere',
          color: tone === 'warning' ? 'warning.main' : 'text.primary',
        }}
      >
        {value}
      </Typography>
    </Box>
  )
}

export default function FilamentSheet({
  entry, onClose, onQuantity, currency, position, onStep,
}: FilamentSheetProps) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const open = entry !== null

  // ← and → step, but never out of a field someone is typing in. Escape is
  // handled here too: stepping to a colour you do not own removes the stepper
  // that had focus, and the dialog's own Escape only hears keys from inside it.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.activeElement === document.body) {
        onClose()
        return
      }
      const target = event.target as HTMLElement | null
      if (target?.closest('input:not([type="checkbox"]), textarea')) return
      if (event.key === 'ArrowLeft' && position.index > 0) onStep(-1)
      if (event.key === 'ArrowRight' && position.index < position.total - 1) onStep(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, position, onStep, onClose])

  const stock = entry?.stock
  const percent = stock?.lowestPercent ?? null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="filament-sheet-title"
      slots={{ transition: phone ? SlideUp : Fade }}
      sx={{ '& .MuiDialog-container': { alignItems: { xs: 'flex-end', sm: 'center' } } }}
      slotProps={{
        paper: {
          sx: {
            m: { xs: 0, sm: 4 },
            width: { xs: '100%', sm: 460 },
            maxWidth: { xs: '100%', sm: 460 },
            maxHeight: { xs: 'calc(100dvh - 48px)', sm: 'calc(100dvh - 64px)' },
            borderRadius: { xs: '14px 14px 0 0', sm: '14px' },
            pb: 'var(--sp-safe-bottom)',
          },
        },
      }}
    >
      {entry && (
        <Box sx={{ overflowY: 'auto' }}>
          {/* The stage: the reel at size, on the neutral wash, with the run's
              arrows either side of it and the close in the corner. */}
          <Box
            sx={{
              position: 'relative',
              bgcolor: 'action.hover',
              borderBottom: '1px solid', borderColor: 'divider',
              pt: { xs: 1.25, sm: 2 }, pb: 2,
            }}
          >
            {phone && (
              <Box
                aria-hidden
                sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'divider', mx: 'auto', mb: 1 }}
              />
            )}
            <IconButton
              aria-label="Close"
              onClick={onClose}
              sx={{ position: 'absolute', top: 8, right: 8 }}
            >
              <CloseRoundedIcon />
            </IconButton>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'center', gap: 1 }}>
              <IconButton
                aria-label="Previous colour"
                disabled={position.index <= 0}
                onClick={() => onStep(-1)}
              >
                <ChevronLeftRoundedIcon />
              </IconButton>
              <Box
                key={entry.color.key}
                sx={{
                  px: 3, py: 1,
                  '@media (prefers-reduced-motion: no-preference)': {
                    animation: `sheet-reel 0.42s ${EASE_IOS}`,
                  },
                  '@keyframes sheet-reel': {
                    from: { transform: 'translateY(6px) rotate(-6deg)', opacity: 0.4 },
                    to: { transform: 'none', opacity: 1 },
                  },
                }}
              >
                <SpoolArt
                  hexes={entry.color.hexes}
                  size={128}
                  fill={stock ? (percent === null ? null : percent / 100) : 1}
                  faded={entry.color.discontinued}
                  label={stock ? stock.loaded.map(trayName).join(',') : undefined}
                />
              </Box>
              <IconButton
                aria-label="Next colour"
                disabled={position.index >= position.total - 1}
                onClick={() => onStep(1)}
              >
                <ChevronRightRoundedIcon />
              </IconButton>
            </Stack>
            {position.total > 1 && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ textAlign: 'center', fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums' }}
              >
                {position.index + 1} of {position.total}
              </Typography>
            )}
          </Box>

          <Stack spacing={2} sx={{ p: 2.5 }}>
            <Box>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
                <Box
                  sx={{
                    px: 1, py: 0.25, borderRadius: '8px',
                    bgcolor: 'text.primary', color: 'background.paper',
                    fontSize: '0.6875rem', fontWeight: 650,
                  }}
                >
                  {entry.line.brandLabel}
                </Box>
                <Typography variant="body2" color="text.secondary">{entry.line.label}</Typography>
              </Stack>
              <Typography variant="h1" component="h2" id="filament-sheet-title" sx={{ fontSize: '1.375rem' }}>
                {entry.color.name}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {[entry.color.code, entry.color.hexes.join(' / ')].filter(Boolean).join(' · ')}
                {entry.color.discontinued && <> · <i>discontinued</i></>}
              </Typography>
            </Box>

            {(stock || entry.usage || entry.pricePerKg !== null) && (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: 1.5,
                  p: 1.5,
                  borderRadius: '14px',
                  border: '1px solid', borderColor: 'divider',
                }}
              >
                {stock && (
                  <Fact
                    label="In the AMS"
                    value={stockNote(stock)}
                    tone={stock.status === 'reorder' ? 'warning' : undefined}
                  />
                )}
                {entry.usage && (
                  <Fact
                    label="Printed"
                    value={`${formatGrams(entry.usage.grams)} used · ${entry.usage.prints} ${entry.usage.prints === 1 ? 'print' : 'prints'}`}
                  />
                )}
                {entry.pricePerKg !== null && currency && (
                  <Fact label="Price" value={`${formatMoney(entry.pricePerKg, currency)} / kg`} />
                )}
              </Box>
            )}

            <Box component="section" aria-labelledby="filament-sheet-shelf">
              <Typography variant="h3" component="h3" id="filament-sheet-shelf" sx={{ mb: 1 }}>
                On your shelf
              </Typography>
              <Stack spacing={1}>
                {entry.line.variants.map(variant => {
                  const quantity = entry.quantities[variant]
                  const label = tickName(entry.line, entry.color, variant)
                  const noun = VARIANT_NOUN[variant][0]
                  return (
                    <Box
                      key={variant}
                      component="label"
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 1.5,
                        p: 1, pl: 1.5, minHeight: 64,
                        borderRadius: '14px',
                        border: '1px solid',
                        borderColor: quantity > 0 ? 'primary.main' : 'divider',
                        bgcolor: quantity > 0 ? 'action.selected' : 'transparent',
                        cursor: 'pointer',
                        transition: `border-color 0.2s ${EASE_IOS}, background-color 0.2s ${EASE_IOS}`,
                      }}
                    >
                      <SpoolArt hexes={entry.color.hexes} variant={variant} size={40} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 650 }}>
                          {VARIANT_TITLE[variant]}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                          {VARIANT_NOTE[variant]}
                        </Typography>
                      </Box>
                      {quantity > 0 && (
                        // Stops at one. Going to none is unticking, which is a
                        // different decision and already has its own control.
                        <Stack
                          direction="row"
                          role="group"
                          aria-label={`How many: ${label}`}
                          sx={{ alignItems: 'center' }}
                          onClick={event => event.preventDefault()}
                        >
                          <IconButton
                            size="small"
                            aria-label={`One fewer ${noun}`}
                            disabled={quantity <= 1}
                            onClick={() => onQuantity(entry.color.key, variant, quantity - 1)}
                          >
                            <RemoveRoundedIcon fontSize="small" />
                          </IconButton>
                          <Typography
                            aria-live="polite"
                            sx={{
                              minWidth: 28, textAlign: 'center', fontWeight: 650,
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            <span aria-hidden>{quantity}</span>
                            <Box component="span" sx={visuallyHidden}>{countOf(variant, quantity)}</Box>
                          </Typography>
                          <IconButton
                            size="small"
                            aria-label={`One more ${noun}`}
                            disabled={quantity >= MAX_QUANTITY}
                            onClick={() => onQuantity(entry.color.key, variant, quantity + 1)}
                          >
                            <AddRoundedIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      )}
                      <Checkbox
                        checked={quantity > 0}
                        onChange={event => onQuantity(entry.color.key, variant, event.target.checked ? 1 : 0)}
                        slotProps={{ input: { 'aria-label': label } }}
                      />
                    </Box>
                  )
                })}
              </Stack>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
              A tick saves as you make it.
            </Typography>
          </Stack>
        </Box>
      )}
    </Dialog>
  )
}

const visuallyHidden = {
  // Strings, not numbers: in `sx` a width of 1 means 100%.
  position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px',
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const
