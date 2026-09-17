// How thick a traced drawing becomes, and whether it gets a plate behind it.
import { useState } from 'react'
import {
  Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  InputAdornment, Stack, TextField, Typography,
} from '@mui/material'
import type { BadgeOptions } from './extrude.ts'

export interface ExtrudeDialogProps {
  open: boolean
  onExtrude: (options: BadgeOptions) => void
  onClose: () => void
}

const number = (value: string): number => Number(value.replace(',', '.'))
const valid = (value: string): boolean => {
  const n = number(value)
  return Number.isFinite(n) && n > 0 && n <= 500
}

export default function ExtrudeDialog({ open, onExtrude, onClose }: ExtrudeDialogProps) {
  const [thickness, setThickness] = useState('3')
  const [plate, setPlate] = useState(true)
  const [margin, setMargin] = useState('2')
  const [plateThickness, setPlateThickness] = useState('1.5')
  const ok = valid(thickness) && (!plate || (valid(margin) && valid(plateThickness)))

  const mm = (
    label: string, value: string, set: (value: string) => void, disabled = false,
  ) => (
    <TextField
      size="small" label={label} value={value} disabled={disabled}
      onChange={event => set(event.target.value)}
      error={!disabled && !valid(value)}
      slotProps={{
        htmlInput: { inputMode: 'decimal' },
        input: { endAdornment: <InputAdornment position="end">mm</InputAdornment> },
      }}
    />
  )

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <form
        onSubmit={event => {
          event.preventDefault()
          if (!ok) return
          onExtrude({
            thicknessMm: number(thickness),
            ...(plate
              ? { plate: { marginMm: number(margin), thicknessMm: number(plateThickness) } }
              : {}),
          })
        }}
      >
        <DialogTitle>Give it thickness</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {mm('Artwork thickness', thickness, setThickness)}
            <FormControlLabel
              control={(
                <Checkbox
                  size="small" checked={plate}
                  onChange={event => setPlate(event.target.checked)}
                />
              )}
              label={<Typography variant="body2">Add a plate behind it</Typography>}
            />
            <Stack direction="row" spacing={2}>
              {mm('Plate margin', margin, setMargin, !plate)}
              {mm('Plate thickness', plateThickness, setPlateThickness, !plate)}
            </Stack>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              The artwork stands on the plate, so the two meet instead of overlapping.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={!ok}>Extrude</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
