// What a kilogram of one line costs, edited in place.
//
// Committed on blur rather than on every keystroke: a price is typed in one
// go, and a half-typed "1" is not a price anyone means. Until a currency is
// chosen there is nothing to price in, so the field waits for one.
import { useEffect, useState } from 'react'
import { InputAdornment, TextField, Tooltip } from '@mui/material'

export interface PriceFieldProps {
  label: string
  pricePerKg: number | null
  currency: string | null
  onPrice: (pricePerKg: number | null) => void
}

const parse = (value: string): number | null => {
  const trimmed = value.trim().replace(',', '.')
  if (!trimmed) return null
  const amount = Number(trimmed)
  return Number.isFinite(amount) && amount > 0 && amount <= 100_000 ? amount : NaN
}

export default function PriceField({ label, pricePerKg, currency, onPrice }: PriceFieldProps) {
  const [draft, setDraft] = useState(pricePerKg === null ? '' : String(pricePerKg))
  // Follows the stored value when it changes underneath, which a reload does.
  useEffect(() => { setDraft(pricePerKg === null ? '' : String(pricePerKg)) }, [pricePerKg])
  const parsed = parse(draft)
  const invalid = Number.isNaN(parsed)

  return (
    <Tooltip title={currency ? `Price per kilogram of ${label}` : 'Choose a currency first.'}>
      <TextField
        size="small"
        label="Per kg"
        value={draft}
        disabled={!currency}
        error={invalid}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => {
          if (invalid) { setDraft(pricePerKg === null ? '' : String(pricePerKg)); return }
          if (parsed !== pricePerKg) onPrice(parsed)
        }}
        onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
        sx={{ width: 130 }}
        slotProps={{
          htmlInput: { inputMode: 'decimal', 'aria-label': `Price per kg of ${label}` },
          input: currency
            ? { startAdornment: <InputAdornment position="start">{currency}</InputAdornment> }
            : undefined,
        }}
      />
    </Tooltip>
  )
}
