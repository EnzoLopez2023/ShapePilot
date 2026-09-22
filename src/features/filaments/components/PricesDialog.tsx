// What a kilogram of each line costs, set in one place.
//
// The prices exist for one reason: Print usage turns the grams your prints
// used into money. They used to sit in every line's header, which put a text
// field and a currency picker in front of someone who came to tick a spool.
// Here they are one tap away and say what they are for.
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField,
  Typography,
} from '@mui/material'
import type { FilamentLine } from '../../../../lib/contracts/bambuFilaments.ts'
import PriceField from './PriceField.tsx'

/**
 * The currencies to price in. A short list rather than every ISO code: this is
 * one household's shelf, and nothing here converts between them anyway.
 */
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CAD', 'AUD'] as const

export interface PricesDialogProps {
  open: boolean
  onClose: () => void
  lines: readonly { id: string; line: FilamentLine }[]
  priceByLine: ReadonlyMap<string, number>
  currency: string | null
  onCurrency: (next: string) => void
  onPrice: (line: string, pricePerKg: number | null) => void
}

export default function PricesDialog({
  open, onClose, lines, priceByLine, currency, onCurrency, onPrice,
}: PricesDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="prices-title">
      <DialogTitle id="prices-title">Filament prices</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          What you pay per kilogram of each line. Print usage multiplies the grams your prints
          used by these to show what they cost. Amounts are kept in the one currency you pick;
          nothing is converted.
        </Typography>
        <TextField
          select
          size="small"
          label="Prices in"
          value={currency ?? ''}
          onChange={event => onCurrency(event.target.value)}
          sx={{ width: 160, mb: 2 }}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          <MenuItem value="" disabled>Currency</MenuItem>
          {CURRENCIES.map(code => <MenuItem key={code} value={code}>{code}</MenuItem>)}
        </TextField>
        <Stack divider={<Box sx={{ borderTop: '1px solid', borderColor: 'divider' }} />}>
          {lines.map(({ id, line }) => (
            <Stack
              key={id}
              direction="row"
              sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, py: 1 }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{line.label}</Typography>
              <PriceField
                label={line.label}
                pricePerKg={priceByLine.get(id) ?? null}
                currency={currency}
                onPrice={value => onPrice(id, value)}
              />
            </Stack>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  )
}
