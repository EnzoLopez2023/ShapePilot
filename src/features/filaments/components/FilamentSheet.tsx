// Everything about one colour: what is on hand, what it cost, where it went.
//
// A bottom sheet on a phone, a dialog on a desk. Nothing here is ticked any
// more -- rolls come from orders -- so the one thing a person can say is that a
// roll ran out before the printer's gram estimates said it would. That mark is
// the override the automatic count needs, and it can be taken back.
//
// The sheet steps through the colours that were on screen when it opened
// (arrows, or ← and → on a keyboard).
import { forwardRef, useEffect } from 'react'
import type { ReactElement, Ref } from 'react'
import {
  Box, Button, Dialog, Fade, IconButton, Link, Slide, Stack, Typography, useMediaQuery,
} from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import type { TransitionProps } from '@mui/material/transitions'
import { useTheme } from '@mui/material/styles'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import type { FilamentColor, FilamentLine, FilamentVariant } from '../../../../lib/contracts/bambuFilaments.ts'
import type { ColorStock } from '../../../../lib/contracts/filamentStock.ts'
import type { FilamentUsageTotals } from '../../../../lib/contracts/filamentUsage.ts'
import type { ColorLedger, KilogramPrice } from '../../../../lib/contracts/filamentOrders.ts'
import { trayName } from '../model/ams.ts'
import { formatMoney } from '../model/cost.ts'
import { SpoolArt } from './SpoolArt.tsx'
import { formatExactGrams, rollsLabel, stockNote } from '../model/shelf.ts'
import { EASE_IOS } from '../../../theme/theme.ts'

const FORM: Record<FilamentVariant, string> = {
  spool: 'With spool',
  refill: 'Refill',
}

const formatDate = (iso: string): string => {
  const date = new Date(`${iso}T12:00:00`)
  return Number.isNaN(date.getTime()) ? iso
    : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

export interface SheetEntry {
  line: FilamentLine
  color: FilamentColor
  ledger?: ColorLedger
  stock?: ColorStock
  usage?: FilamentUsageTotals
  /** What a kilogram costs: this colour's own average, or its line's. */
  price: KilogramPrice | null
}

export interface FilamentSheetProps {
  entry: SheetEntry | null
  onClose: () => void
  /** Set how many of this colour's rolls are marked used up. */
  onFinished: (key: string, finished: number) => void
  /** True while a mark is being saved. */
  busy: boolean
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
  entry, onClose, onFinished, busy, position, onStep,
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

            {(() => {
              const ledger = entry.ledger
              const rolls = ledger?.rollsOnHand ?? 0
              const ownPrice = ledger?.costPerKg !== null && ledger?.costPerKg !== undefined
              return (
                <>
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
                    <Fact
                      label="On hand"
                      value={rolls > 0
                        ? `${rollsLabel(rolls)} · ${formatExactGrams(ledger!.gramsAvailable)}`
                        : 'None'}
                    />
                    {entry.usage && (
                      <Fact
                        label="Printed"
                        value={`${formatExactGrams(entry.usage.grams)} · ${entry.usage.prints} ${entry.usage.prints === 1 ? 'print' : 'prints'}`}
                      />
                    )}
                    {entry.price && (
                      <Fact
                        label={ownPrice ? 'Average paid' : 'Line average'}
                        value={`${formatMoney(entry.price.pricePerKg, entry.price.currency)} / kg`}
                      />
                    )}
                    {stock && (
                      <Fact
                        label="In the AMS"
                        value={stockNote(stock)}
                        tone={stock.status === 'reorder' ? 'warning' : undefined}
                      />
                    )}
                  </Box>

                  {ledger && ledger.gramsUnaccounted > 0 && (
                    <Typography variant="body2" sx={{ color: 'warning.main' }}>
                      {formatExactGrams(ledger.gramsUnaccounted)} printed with no order behind it.
                      {' '}A roll is missing from your orders.
                    </Typography>
                  )}

                  <Box component="section" aria-labelledby="filament-sheet-rolls">
                    <Stack
                      direction="row"
                      sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 1, gap: 1 }}
                    >
                      <Typography variant="h3" component="h3" id="filament-sheet-rolls">Rolls</Typography>
                      <Link
                        component={RouterLink}
                        to={`/filaments/orders?add=${encodeURIComponent(entry.color.key)}`}
                        variant="body2"
                      >
                        Add a roll without an invoice
                      </Link>
                    </Stack>
                    {!ledger || ledger.rolls.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No order of this colour is logged.
                      </Typography>
                    ) : (
                      <Stack
                        component="ol"
                        sx={{ listStyle: 'none', p: 0, m: 0 }}
                        divider={<Box sx={{ borderTop: '1px solid', borderColor: 'divider' }} />}
                      >
                        {ledger.rolls.map((roll, index) => {
                          const state = index < ledger.finished ? 'Used up'
                            : index === ledger.finished && ledger.usedGrams
                              > ledger.rolls.slice(0, index).reduce((sum, r) => sum + r.grams, 0)
                              ? 'In use' : 'On the shelf'
                          return (
                            <Stack
                              component="li"
                              key={`${roll.orderId}-${index}`}
                              direction="row"
                              sx={{ alignItems: 'center', gap: 1.5, py: 0.75, opacity: state === 'Used up' ? 0.55 : 1 }}
                            >
                              <SpoolArt hexes={entry.color.hexes} variant={roll.variant} size={32} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                  {FORM[roll.variant]} · {formatExactGrams(roll.grams)}
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                                  {formatDate(roll.orderedAt)} · {state}
                                </Typography>
                              </Box>
                              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                {roll.cost === null ? '—' : formatMoney(roll.cost, roll.currency)}
                              </Typography>
                            </Stack>
                          )
                        })}
                      </Stack>
                    )}
                  </Box>

                  {ledger && ledger.rolls.length > 0 && (
                    <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Button
                        variant="outlined"
                        size="small"
                        disabled={busy || rolls === 0}
                        onClick={() => onFinished(entry.color.key, ledger.finished + 1)}
                      >
                        Mark a roll used up
                      </Button>
                      {ledger.finishedByHand > 0 && (
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() => onFinished(entry.color.key, ledger.finished - 1)}
                        >
                          Undo
                        </Button>
                      )}
                      <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem', flexBasis: '100%' }}>
                        A roll counts as used up on its own once its grams are printed. Mark one
                        sooner when a reel runs out early.
                      </Typography>
                    </Stack>
                  )}
                </>
              )
            })()}
          </Stack>
        </Box>
      )}
    </Dialog>
  )
}
