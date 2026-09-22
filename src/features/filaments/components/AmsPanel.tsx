// What is in the AMS right now, drawn the way Bambu Handy draws it.
//
// Each tray is a reel seen from the side, with the tray name printed on the
// coil and the material above it on a bar of the filament's own colour. The
// coil's height shrinks toward the hub with what the AMS reports is left, so
// the picture answers "how full" before any number does; an unreported amount
// is drawn full and faded, because the AMS said nothing.
//
// A tray whose colour is in the catalogue opens that colour's sheet, so the
// quickest way to "I just loaded a new Jade White" is a tap on A2.
import { Box, ButtonBase, Paper, Stack, Typography } from '@mui/material'
import { filamentByKey } from '../../../../lib/contracts/bambuFilaments.ts'
import { SPOOL_GRAMS } from '../../../../lib/contracts/filamentStock.ts'
import type { AmsStock, ColorStock, LoadedSlot } from '../../../../lib/contracts/filamentStock.ts'
import { colorLabel } from '../model/usage.ts'
import type { AmsBay } from '../model/ams.ts'
import { amsUnits } from '../model/ams.ts'
import { SpoolArt } from './SpoolArt.tsx'
import { EASE_IOS } from '../../../theme/theme.ts'

const hexesOf = (slot: LoadedSlot): string[] => {
  const color = slot.key ? filamentByKey(slot.key) : undefined
  if (color) return [...color.hexes]
  return slot.color ? [slot.color] : ['#8A9096']
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

function Bay({ bay, stock, onOpen }: { bay: AmsBay; stock?: ColorStock; onOpen?: (key: string) => void }) {
  const slot = bay.slot
  if (!slot) {
    return (
      <Stack sx={{ alignItems: 'center', gap: 0.75, py: 1 }}>
        <Box sx={{ height: 4, width: 28, borderRadius: 2, bgcolor: 'divider', mt: 2.25 }} />
        <Box
          sx={{
            width: 66, height: 72, borderRadius: '14px',
            border: '1.5px dashed', borderColor: 'divider',
            display: 'grid', placeItems: 'center',
          }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 650, fontSize: '0.75rem' }}>
            {bay.label}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary">Empty</Typography>
      </Stack>
    )
  }
  const hexes = hexesOf(slot)
  const { name, detail } = describe(slot)
  const reorder = stock?.status === 'reorder'
  const key = slot.key
  // "Light Gray 10104" reads better as a name over its code in a column this narrow.
  const code = key ? filamentByKey(key)?.code : undefined
  const content = (
    <Stack sx={{ alignItems: 'center', gap: 0.75, width: '100%', minWidth: 0 }}>
      <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 600 }}>
        {slot.material ?? '—'}
      </Typography>
      <Box
        aria-hidden
        sx={{
          height: 4, width: 28, borderRadius: 2,
          background: hexes.length > 1 ? `linear-gradient(90deg, ${hexes[0]}, ${hexes[1]})` : hexes[0],
          border: '1px solid', borderColor: 'divider',
        }}
      />
      <Box className="bay-reel">
        <SpoolArt
          hexes={hexes}
          size={80}
          fill={slot.remainingPercent === null ? null : slot.remainingPercent / 100}
          label={bay.label}
        />
      </Box>
      <Box sx={{ textAlign: 'center', minWidth: 0, width: '100%' }}>
        <Typography variant="body2" sx={{ fontWeight: 650, lineHeight: 1.3 }}>
          {code ? name.slice(0, -code.length - 1) : name}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem', lineHeight: 1.35 }}>
          {code ? <>{code}<Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}> · {detail}</Box></> : detail}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums', mt: 0.25,
            color: reorder ? 'warning.main' : 'text.secondary',
            fontWeight: reorder ? 650 : undefined,
          }}
        >
          {slot.remainingPercent === null ? 'Not reported' : (
            <>
              {slot.remainingPercent}%
              <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                {' '}· ≈{Math.round((slot.remainingPercent / 100) * SPOOL_GRAMS)} g
              </Box>
            </>
          )}
          {reorder && ' · reorder'}
          {stock?.status === 'covered' && ' · spare on shelf'}
        </Typography>
      </Box>
    </Stack>
  )
  if (!key || !onOpen) return <Box sx={{ py: 1, minWidth: 0 }}>{content}</Box>
  return (
    <ButtonBase
      onClick={() => onOpen(key)}
      aria-label={`${bay.label}: ${detail} ${name}. Open`}
      sx={{
        py: 1, px: 0.5, borderRadius: '14px', minWidth: 0,
        // Top-aligned, so one tray's wrapped note does not push its
        // neighbours' reels down out of line.
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'stretch',
        transition: `background-color 0.2s ${EASE_IOS}`,
        '&:hover': { bgcolor: 'action.hover' },
        '& .bay-reel': { transition: `transform 0.35s ${EASE_IOS}` },
        '@media (hover: hover) and (prefers-reduced-motion: no-preference)': {
          '&:hover .bay-reel': { transform: 'translateY(-2px) rotate(-4deg)' },
        },
      }}
    >
      {content}
    </ButtonBase>
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
  /** Open a catalogue colour's sheet. */
  onOpen?: (key: string) => void
}

export default function AmsPanel({ ams, stock, onOpen }: AmsPanelProps) {
  const units = amsUnits(ams)
  if (!units.length) return null

  return (
    <Paper component="section" aria-labelledby="ams-heading" sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Stack
        direction="row"
        sx={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 2, mb: 1, flexWrap: 'wrap' }}
      >
        <Typography variant="h2" component="h2" id="ams-heading">In the AMS</Typography>
        <Typography variant="body2" color="text.secondary">
          Reported {formatTime(ams.receivedAt)}
        </Typography>
      </Stack>

      <Stack spacing={1.5}>
        {units.map(unit => (
          <Box
            key={unit.id}
            // The unit described in full, for anyone who cannot see the
            // picture; each tray inside is also its own button.
            role="group"
            aria-label={`${unit.name}: ${unit.bays.map(bayName).join('; ')}`}
            sx={{ borderRadius: '14px', border: '1px solid', borderColor: 'divider', p: { xs: 1, sm: 1.5 } }}
          >
            <Typography variant="body2" sx={{ fontWeight: 650, mb: 0.5, px: 0.5 }}>
              {unit.name.replace(/^AMS (\d+)$/, (_, n: string) => `AMS-${String.fromCharCode(64 + Number(n))}`)}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.max(unit.bays.length, 1)}, minmax(0, 1fr))`,
                gap: { xs: 0.5, sm: 1.5 },
              }}
            >
              {unit.bays.map(bay => (
                <Bay
                  key={bay.label} bay={bay} onOpen={onOpen}
                  stock={bay.slot?.key ? stock.get(bay.slot.key) : undefined}
                />
              ))}
            </Box>
          </Box>
        ))}
      </Stack>
    </Paper>
  )
}
