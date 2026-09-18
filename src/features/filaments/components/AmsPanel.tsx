// What is in the AMS right now, drawn as the AMS.
//
// The body is a fixed dark grey in both themes, because it is a picture of a
// dark grey object -- the one place on this page where a surface colour is
// literal rather than a token. Everything that is information (names, amounts,
// the reorder note) sits below the body on the page's own surface, in its own
// type, so the drawing never carries text a person has to read against it
// except the tray names the printer itself prints on the unit.
//
// Each spool's filament is drawn as a disc that shrinks with what the AMS
// reports is left, so the picture answers "how full" before any number does.
// A spool whose remaining amount is unreported is drawn full and faded: the
// AMS said nothing, and the drawing does not pretend otherwise.
import { useId } from 'react'
import { Box, Paper, Stack, Typography } from '@mui/material'
import { filamentByKey } from '../../../../lib/contracts/bambuFilaments.ts'
import { SPOOL_GRAMS } from '../../../../lib/contracts/filamentStock.ts'
import type { AmsStock, ColorStock, LoadedSlot } from '../../../../lib/contracts/filamentStock.ts'
import { colorLabel } from '../model/usage.ts'
import type { AmsBay } from '../model/ams.ts'
import { amsUnits } from '../model/ams.ts'

/** The AMS 2 Pro's own plastics: literal colours, not theme tokens. */
const BODY = '#1D2125'
const WINDOW = '#262B30'
const FLANGE = '#3A4046'
const HUB = '#14171A'
const PRINTED_TEXT = '#C9CED3'

const hexesOf = (slot: LoadedSlot): string[] => {
  const color = slot.key ? filamentByKey(slot.key) : undefined
  if (color) return [...color.hexes]
  return slot.color ? [slot.color] : ['#8A9096']
}

function Spool({ slot }: { slot: LoadedSlot | null }) {
  const gradientId = useId()
  if (!slot) {
    return (
      <svg viewBox="0 0 100 100" width="100%" aria-hidden style={{ display: 'block' }}>
        <circle cx="50" cy="50" r="44" fill="none" stroke={FLANGE} strokeWidth="2" strokeDasharray="5 5" />
        <circle cx="50" cy="50" r="14" fill={HUB} stroke={FLANGE} strokeWidth="2" />
      </svg>
    )
  }
  const hexes = hexesOf(slot)
  const known = slot.remainingPercent !== null
  const share = known ? Math.max(0, Math.min(100, slot.remainingPercent!)) / 100 : 1
  // Between the hub and the flange: an empty spool is just the hub.
  const radius = 17 + 25 * share
  const fill = hexes.length > 1 ? `url(#${gradientId})` : hexes[0]

  return (
    <svg viewBox="0 0 100 100" width="100%" aria-hidden style={{ display: 'block' }}>
      {hexes.length > 1 && (
        // A dual-colour filament is a 135° split of its two hexes, as the
        // swatch draws it everywhere else on the page.
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="50%" stopColor={hexes[0]} />
            <stop offset="50%" stopColor={hexes[1]} />
          </linearGradient>
        </defs>
      )}
      <circle cx="50" cy="50" r="46" fill={FLANGE} />
      <circle
        cx="50" cy="50" r={radius} fill={fill} opacity={known ? 1 : 0.55}
        // The structural ring: white and near-black filaments vanish without it.
        stroke="rgba(255,255,255,0.35)" strokeWidth="1"
      />
      <circle cx="50" cy="50" r="15" fill={HUB} />
      <circle cx="50" cy="50" r="5" fill={FLANGE} />
    </svg>
  )
}

function describe(slot: LoadedSlot): { name: string; detail: string } {
  if (slot.key) {
    const [line, rest] = colorLabel(slot.key).split(' · ')
    return { name: rest ?? line, detail: line }
  }
  return {
    name: slot.subBrand ?? slot.material ?? 'Unknown filament',
    detail: 'Not in the catalogue',
  }
}

function amount(slot: LoadedSlot): string {
  if (slot.remainingPercent === null) return 'Amount not reported'
  const grams = Math.round((slot.remainingPercent / 100) * SPOOL_GRAMS)
  return `${slot.remainingPercent}% · ≈${grams} g`
}

function BayDetail({ bay, stock }: { bay: AmsBay; stock?: ColorStock }) {
  if (!bay.slot) {
    return <Typography variant="body2" color="text.secondary">Empty</Typography>
  }
  const { name, detail } = describe(bay.slot)
  return (
    <Stack sx={{ minWidth: 0 }}>
      <Typography variant="body2" sx={{ fontWeight: 650, overflowWrap: 'anywhere' }}>{name}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{detail}</Typography>
      <Typography
        variant="body2"
        sx={{
          color: stock?.status === 'reorder' ? 'warning.main' : 'text.secondary',
          fontWeight: stock?.status === 'reorder' ? 650 : undefined,
        }}
      >
        {amount(bay.slot)}
        {stock?.status === 'reorder' && ' · reorder'}
        {stock?.status === 'covered' && ' · spare on shelf'}
      </Typography>
    </Stack>
  )
}

const bayName = (bay: AmsBay): string => {
  if (!bay.slot) return `${bay.label}: empty`
  const { name, detail } = describe(bay.slot)
  return `${bay.label}: ${detail} ${name}, ${amount(bay.slot)}`
}

const formatTime = (iso: string): string => {
  const taken = new Date(iso)
  if (Number.isNaN(taken.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  }).format(taken)
}

export interface AmsPanelProps {
  ams: AmsStock
  /** Stock by catalogue key, for the reorder note under a loaded spool. */
  stock: ReadonlyMap<string, ColorStock>
}

export default function AmsPanel({ ams, stock }: AmsPanelProps) {
  const units = amsUnits(ams)
  if (!units.length) return null

  return (
    <Paper component="section" aria-labelledby="ams-heading" sx={{ p: 2 }}>
      <Stack
        direction="row"
        sx={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 2, mb: 1.5, flexWrap: 'wrap' }}
      >
        <Typography variant="h2" component="h2" id="ams-heading">In the AMS</Typography>
        <Typography variant="body2" color="text.secondary">
          As the printer reported it, {formatTime(ams.receivedAt)}
        </Typography>
      </Stack>

      <Stack spacing={2}>
        {units.map(unit => (
          <Box key={unit.id} role="group" aria-label={unit.name}>
            {units.length > 1 && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>{unit.name}</Typography>
            )}
            <Box
              role="img"
              aria-label={`${unit.name}: ${unit.bays.map(bayName).join('; ')}`}
              sx={{
                bgcolor: BODY, borderRadius: '14px', p: { xs: 1, sm: 1.5 },
                // The page's own hairline, so the unit reads as an object on a
                // dark ground that is nearly its own colour.
                border: '1px solid', borderColor: 'divider',
              }}
            >
              <Box
                sx={{
                  bgcolor: WINDOW,
                  // The one radius, as everywhere else (DESIGN.md).
                  borderRadius: '14px',
                  // A faint top edge, as light catches the smoked lid.
                  borderTop: '1px solid rgba(255,255,255,0.12)',
                  display: 'grid',
                  gridTemplateColumns: `repeat(${Math.max(unit.bays.length, 1)}, minmax(0, 1fr))`,
                  gap: { xs: 1, sm: 2 },
                  px: { xs: 1, sm: 2 },
                  py: { xs: 1, sm: 1.5 },
                }}
              >
                {unit.bays.map(bay => (
                  <Stack key={bay.label} sx={{ alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: '100%', maxWidth: 110 }}><Spool slot={bay.slot} /></Box>
                    <Typography
                      component="span"
                      sx={{ color: PRINTED_TEXT, fontSize: '0.75rem', fontWeight: 650, letterSpacing: '0.04em' }}
                    >
                      {bay.label}
                    </Typography>
                  </Stack>
                ))}
              </Box>
            </Box>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.max(unit.bays.length, 1)}, minmax(0, 1fr))`,
                gap: { xs: 1, sm: 2 },
                px: { xs: 1, sm: 2 },
                pt: 1,
              }}
            >
              {unit.bays.map(bay => (
                <BayDetail
                  key={bay.label} bay={bay}
                  stock={bay.slot?.key ? stock.get(bay.slot.key) : undefined}
                />
              ))}
            </Box>
          </Box>
        ))}
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
        Below, a loaded colour sits on a shaded row with its tray named; a colour you have printed
        with that is not loaded has its name in bold.
      </Typography>
    </Paper>
  )
}
