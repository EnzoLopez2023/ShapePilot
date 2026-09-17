// Size and thickness for a hardware cutter, asked once as it is added.
//
// With a part selected, the cutter is sized to that part and lands in its
// middle, selected, so it can be nudged into place and grouped (G) to cut.
import { useState } from 'react'
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, MenuItem,
  Stack, TextField, Typography,
} from '@mui/material'
import type { MetricSize } from '../hardware.ts'
import { METRIC_SIZES } from '../hardware.ts'
import type { FastenerEntry } from './libraryEntries.ts'

export interface FastenerTarget {
  name: string
  thicknessMm: number
}

export interface FastenerDialogProps {
  entry: FastenerEntry | null
  target: FastenerTarget | null
  onAdd: (size: MetricSize, thicknessMm: number) => void
  onClose: () => void
}

const DEFAULT_THICKNESS_MM = 5

export default function FastenerDialog({ entry, target, onAdd, onClose }: FastenerDialogProps) {
  // Remembered across openings: the same screw tends to be used several times.
  const [size, setSize] = useState<MetricSize>('M3')
  return (
    <Dialog open={Boolean(entry)} onClose={onClose} maxWidth="xs" fullWidth>
      {entry && (
        <FastenerForm
          // Remounted per opening, so the thickness starts from the target.
          key={`${entry.id}:${target?.name ?? ''}:${target?.thicknessMm ?? ''}`}
          entry={entry} target={target} size={size} onSize={setSize}
          onAdd={onAdd} onClose={onClose}
        />
      )}
    </Dialog>
  )
}

function FastenerForm({ entry, target, size, onSize, onAdd, onClose }: {
  entry: FastenerEntry
  target: FastenerTarget | null
  size: MetricSize
  onSize: (size: MetricSize) => void
  onAdd: FastenerDialogProps['onAdd']
  onClose: () => void
}) {
  const [thickness, setThickness] = useState(
    String(target ? Math.round(target.thicknessMm * 100) / 100 : DEFAULT_THICKNESS_MM))
  const value = Number(thickness)
  const valid = Number.isFinite(value) && value > 0 && value <= 1000

  return (
    <form onSubmit={event => { event.preventDefault(); if (valid) onAdd(size, value) }}>
      <DialogTitle>{entry.label}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            select size="small" label="Size" value={size}
            onChange={event => onSize(event.target.value as MetricSize)}
          >
            {METRIC_SIZES.map(option => <MenuItem key={option} value={option}>{option}</MenuItem>)}
          </TextField>
          <TextField
            size="small" label="Material thickness" value={thickness}
            onChange={event => setThickness(event.target.value)}
            error={!valid}
            helperText={valid ? undefined : 'Enter a thickness above zero.'}
            slotProps={{
              htmlInput: { inputMode: 'decimal' },
              input: { endAdornment: <InputAdornment position="end">mm</InputAdornment> },
            }}
          />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {target
              ? `Placed in the middle of ${target.name}. Nudge it into position, then select both and press G to cut.`
              : 'Placed at the origin. Move it into a part, then select both and press G to cut.'}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={!valid}>Add</Button>
      </DialogActions>
    </form>
  )
}
