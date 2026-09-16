// The one thing on this page that asks you to do something.
//
// Shown only when a loaded spool is at or under the low line with no spare of
// that colour on the shelf. A low spool with a spare behind it is not news --
// the row says so quietly -- and a banner that appeared for it would be a
// banner people learn to scroll past.
//
// It says when the AMS last reported. The warning is built from that reading,
// and a reading from yesterday afternoon is still the best there is, but the
// person deciding whether to order should know which afternoon it was.
import { Alert, Box, Typography } from '@mui/material'
import { LOW_PERCENT, slotLabel } from '../../../../lib/contracts/filamentStock.ts'
import type { ColorStock } from '../../../../lib/contracts/filamentStock.ts'
import { colorLabel } from '../model/usage.ts'

export interface ReorderBannerProps {
  stock: readonly ColorStock[]
  /** When the AMS reading was taken. */
  receivedAt: string
  /** For "as of" wording; injectable so tests are not at the mercy of the clock. */
  now?: Date
}

/** Readings older than this get their age said out loud. */
const STALE_MS = 60 * 60 * 1000

function asOf(receivedAt: string, now: Date): string | null {
  const taken = new Date(receivedAt)
  if (Number.isNaN(taken.getTime()) || now.getTime() - taken.getTime() < STALE_MS) return null
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  }).format(taken)
}

export default function ReorderBanner({ stock, receivedAt, now = new Date() }: ReorderBannerProps) {
  const reorder = stock.filter(entry => entry.status === 'reorder')
  if (reorder.length === 0) return null
  const stale = asOf(receivedAt, now)

  return (
    <Alert severity="warning" role="status" aria-labelledby="reorder-heading">
      <Typography variant="body2" component="h2" id="reorder-heading" sx={{ fontWeight: 650 }}>
        {reorder.length === 1 ? 'Reorder soon' : `Reorder soon · ${reorder.length} colours`}
      </Typography>
      <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.25 }}>
        {reorder.map(entry => {
          const slot = entry.loaded[0]
          return (
            <Typography component="li" variant="body2" key={entry.key}>
              <strong>{colorLabel(entry.key)}</strong>
              {' — '}
              {entry.lowestPercent}% left in {slotLabel(slot)}
              {entry.owned === 0 ? ', and it is not in your inventory' : ', with no spare on the shelf'}
            </Typography>
          )
        })}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        A spool counts as low at {LOW_PERCENT}% or under, as the AMS reads it
        {stale ? <> (last reading {stale})</> : null}. Adding a spare to your count clears it.
      </Typography>
    </Alert>
  )
}
