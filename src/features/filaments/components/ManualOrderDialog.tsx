// Rolls bought without an invoice: a shop counter, a gift, a sample.
//
// One colour per entry, which is what a person has in hand when they log one.
// The price is optional and means what was paid for one roll, tax included --
// a roll with no price is counted on the shelf and left out of every average,
// rather than averaged in as free.
import { useEffect, useMemo, useState } from 'react'
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, MenuItem, Stack,
  TextField, Typography,
} from '@mui/material'
import { filamentByKey, filamentLineById } from '../../../../lib/contracts/bambuFilaments.ts'
import type { FilamentVariant } from '../../../../lib/contracts/bambuFilaments.ts'
import type { FilamentOrderInput } from '../../../../lib/contracts/filamentOrders.ts'
import CatalogColorField from './CatalogColorField.tsx'

export interface ManualOrderDialogProps {
  open: boolean
  /** The colour to start with, e.g. from a colour's sheet. */
  initialKey: string | null
  busy: boolean
  error: string | null
  onClose: () => void
  onSave: (order: FilamentOrderInput) => void
}

const today = (): string => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export default function ManualOrderDialog({
  open, initialKey, busy, error, onClose, onSave,
}: ManualOrderDialogProps) {
  const [key, setKey] = useState<string | null>(initialKey)
  const [variant, setVariant] = useState<FilamentVariant>('spool')
  const [quantity, setQuantity] = useState('1')
  const [grams, setGrams] = useState('1000')
  const [price, setPrice] = useState('')
  const [orderedAt, setOrderedAt] = useState(today)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open) return
    setKey(initialKey)
    setVariant('spool')
    setQuantity('1')
    setGrams('1000')
    setPrice('')
    setOrderedAt(today())
    setNote('')
  }, [open, initialKey])

  const color = key ? filamentByKey(key) : undefined
  const line = color ? filamentLineById(color.line) : undefined
  const variants = useMemo<readonly FilamentVariant[]>(() => line?.variants ?? ['spool'], [line])
  // A line sold only on a reel cannot be logged as a refill.
  useEffect(() => {
    if (!variants.includes(variant)) setVariant(variants[0])
  }, [variants, variant])

  const count = Number(quantity)
  const weight = Number(grams)
  const paid = price.trim() === '' ? null : Number(price.replace(',', '.'))
  const valid = Boolean(key)
    && Number.isInteger(count) && count >= 1 && count <= 999
    && Number.isInteger(weight) && weight >= 1 && weight <= 10000
    && (paid === null || (Number.isFinite(paid) && paid >= 0 && paid <= 100000))
    && /^\d{4}-\d{2}-\d{2}$/.test(orderedAt)

  const save = () => {
    if (!valid || !key || !color) return
    onSave({
      source: 'manual',
      orderNumber: null,
      orderedAt,
      currency: 'USD',
      orderDiscount: 0,
      credit: 0,
      shipping: 0,
      grandTotal: paid === null ? null : Math.round(paid * count * 100) / 100,
      note: note.trim() || null,
      lines: [{
        key,
        description: `${line?.label ?? ''} ${color.name}${color.code ? ` ${color.code}` : ''}`.trim(),
        sku: null,
        variant,
        gramsPerUnit: weight,
        quantity: count,
        // What was paid for one, tax in: there is no separate tax to add.
        unitPrice: paid,
        discount: 0,
        tax: 0,
      }],
    })
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="manual-order-title">
      <DialogTitle id="manual-order-title">Add rolls without an invoice</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <CatalogColorField value={key} onChange={setKey} label="Colour" />
          <Stack direction="row" spacing={1.5}>
            <TextField
              select
              size="small"
              label="Form"
              value={variant}
              onChange={event => setVariant(event.target.value as FilamentVariant)}
              sx={{ flex: 1 }}
            >
              {variants.map(entry => (
                <MenuItem key={entry} value={entry}>{entry === 'spool' ? 'With spool' : 'Refill'}</MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label="How many"
              value={quantity}
              onChange={event => setQuantity(event.target.value)}
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
              sx={{ width: 110 }}
            />
          </Stack>
          <Stack direction="row" spacing={1.5}>
            <TextField
              size="small"
              label="Each roll"
              value={grams}
              onChange={event => setGrams(event.target.value)}
              slotProps={{
                htmlInput: { inputMode: 'numeric' },
                input: { endAdornment: <InputAdornment position="end">g</InputAdornment> },
              }}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              label="Paid per roll"
              placeholder="Not known"
              value={price}
              onChange={event => setPrice(event.target.value)}
              slotProps={{
                htmlInput: { inputMode: 'decimal' },
                input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
              }}
              sx={{ flex: 1 }}
            />
          </Stack>
          <TextField
            size="small"
            type="date"
            label="Bought"
            value={orderedAt}
            onChange={event => setOrderedAt(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            label="Note"
            placeholder="Where it came from"
            value={note}
            onChange={event => setNote(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          <Typography variant="body2" color="text.secondary">
            Leave the price empty if you do not know it: the rolls count on your shelf, and are
            left out of the average price rather than counted as free.
          </Typography>
          {error && <Typography variant="body2" color="error">{error}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={!valid || busy}>Add</Button>
      </DialogActions>
    </Dialog>
  )
}
