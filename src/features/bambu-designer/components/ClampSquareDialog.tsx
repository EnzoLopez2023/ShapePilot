// Size and count for a run of clamping squares, asked as they are added.
import { useState } from 'react'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, Stack,
  TextField, Typography,
} from '@mui/material'
import type { ClampSquareSpec } from '../clampSquare.ts'
import { clampSquareColumns, clampSquareProblem, clampSquaresFootprint } from '../clampSquare.ts'

export interface ClampSquareDialogProps {
  /** The spec to start from; null keeps the dialog closed. */
  initial: ClampSquareSpec | null
  /** The plate, x by y, to warn when the squares will not fit on it. */
  plateMm: readonly [number, number]
  onAdd: (spec: ClampSquareSpec) => void
  onClose: () => void
}

export default function ClampSquareDialog({ initial, plateMm, onAdd, onClose }: ClampSquareDialogProps) {
  return (
    <Dialog open={Boolean(initial)} onClose={onClose} maxWidth="xs" fullWidth>
      {initial && <ClampSquareForm initial={initial} plateMm={plateMm} onAdd={onAdd} onClose={onClose} />}
    </Dialog>
  )
}

type Key = keyof ClampSquareSpec

const inches = (mm: number) => `≈ ${(mm / 25.4).toFixed(1)} in`

function ClampSquareForm({ initial, plateMm, onAdd, onClose }:
  Omit<ClampSquareDialogProps, 'initial'> & { initial: ClampSquareSpec }) {
  const [text, setText] = useState(() =>
    Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, String(v)])) as Record<Key, string>)

  const spec = Object.fromEntries(
    Object.entries(text).map(([k, v]) => [k, v.trim() === '' ? NaN : Number(v)]),
  ) as unknown as ClampSquareSpec
  const problem = clampSquareProblem(spec)
  const [footX, footY] = problem ? [0, 0] : clampSquaresFootprint(spec, clampSquareColumns(spec, plateMm[0]))
  const offPlate = !problem && (footX > plateMm[0] || footY > plateMm[1])

  const field = (key: Key, label: string, unit: string | null, helper?: string) => (
    <TextField
      size="small" label={label} value={text[key]}
      onChange={event => setText(t => ({ ...t, [key]: event.target.value }))}
      helperText={helper}
      slotProps={{
        htmlInput: { inputMode: unit ? 'decimal' : 'numeric' },
        input: unit ? { endAdornment: <InputAdornment position="end">{unit}</InputAdornment> } : undefined,
      }}
    />
  )

  return (
    <form onSubmit={event => { event.preventDefault(); if (!problem) onAdd(spec) }}>
      <DialogTitle>Clamping squares</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Clamp one into each inside corner, a jaw through an opening or over a step onto each leg. Every
            face it grabs is parallel to the panel, so it will not slide. The notched corner clears the
            squeeze-out.
          </Typography>
          <Stack direction="row" spacing={1.5}>
            {field('legMm', 'Leg length', 'mm', Number.isFinite(spec.legMm) ? inches(spec.legMm) : undefined)}
            {field('heightMm', 'Height', 'mm', Number.isFinite(spec.heightMm) ? inches(spec.heightMm) : undefined)}
          </Stack>
          <Stack direction="row" spacing={1.5}>
            {field('steps', 'Steps', null)}
            {field('barMm', 'Bar width', 'mm')}
          </Stack>
          <Stack direction="row" spacing={1.5}>
            {field('reliefMm', 'Corner relief', 'mm')}
            {field('count', 'How many', null)}
          </Stack>
          {problem && <Alert severity="error">{problem}</Alert>}
          {offPlate && (
            <Alert severity="warning">
              They take {Math.round(footX)} × {Math.round(footY)} mm, larger than the {plateMm[0]} × {plateMm[1]} mm
              plate. Make fewer at a time.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={Boolean(problem)}>Add</Button>
      </DialogActions>
    </form>
  )
}
