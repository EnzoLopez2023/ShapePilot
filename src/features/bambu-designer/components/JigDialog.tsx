// Sizes for a plywood alignment jig, asked as it is added.
//
// The last jig's sizes come back next time: a cabinet takes several of the
// same, and the sheet thicknesses only change with the next batch of stock.
import { useState } from 'react'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  InputAdornment, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import type { JigKind, JigSpec } from '../jig.ts'
import { JIG_HOLE_MM, JIG_LABELS, jigFootprint, jigHolesFit, jigProblem } from '../jig.ts'

export interface JigDialogProps {
  /** The spec to start from; null keeps the dialog closed. */
  initial: JigSpec | null
  /** The plate, x by y, to warn when a long jig will not fit on it. */
  plateMm: readonly [number, number]
  onAdd: (spec: JigSpec) => void
  onClose: () => void
}

export default function JigDialog({ initial, plateMm, onAdd, onClose }: JigDialogProps) {
  return (
    <Dialog open={Boolean(initial)} onClose={onClose} maxWidth="xs" fullWidth>
      {initial && <JigForm initial={initial} plateMm={plateMm} onAdd={onAdd} onClose={onClose} />}
    </Dialog>
  )
}

type NumberKey = { [K in keyof JigSpec]: JigSpec[K] extends number ? K : never }[keyof JigSpec]

const asText = (spec: JigSpec) => Object.fromEntries(
  Object.entries(spec).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, String(v)]),
) as Record<NumberKey, string>

function JigForm({ initial, plateMm, onAdd, onClose }: Omit<JigDialogProps, 'initial'> & { initial: JigSpec }) {
  const [kind, setKind] = useState<JigKind>(initial.kind)
  const [holes, setHoles] = useState(initial.holes)
  const [text, setText] = useState(() => asText(initial))

  const spec: JigSpec = {
    kind, holes,
    ...Object.fromEntries(Object.entries(text).map(([k, v]) => [k, v.trim() === '' ? NaN : Number(v)])) as Record<NumberKey, number>,
  }
  const problem = jigProblem(spec)
  const [footX, footY] = jigFootprint(spec)
  const offPlate = !problem && (footX > plateMm[0] || footY > plateMm[1])

  const field = (key: NumberKey, label: string, helper?: string) => (
    <TextField
      size="small" label={label} value={text[key]}
      onChange={event => setText(t => ({ ...t, [key]: event.target.value }))}
      helperText={helper}
      slotProps={{
        htmlInput: { inputMode: 'decimal' },
        input: { endAdornment: <InputAdornment position="end">mm</InputAdornment> },
      }}
    />
  )

  return (
    <form onSubmit={event => { event.preventDefault(); if (!problem) onAdd(spec) }}>
      <DialogTitle>{JIG_LABELS[kind]}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <ToggleButtonGroup
            exclusive fullWidth size="small" value={kind}
            onChange={(_, value: JigKind | null) => { if (value) setKind(value) }}
          >
            <ToggleButton value="tee">T joint</ToggleButton>
            <ToggleButton value="corner">Corner</ToggleButton>
            <ToggleButton value="cross">+ cross</ToggleButton>
          </ToggleButtonGroup>

          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Measure each sheet with calipers: nominal 18 mm stock is often 17.6 to 19.
          </Typography>
          <Stack direction="row" spacing={1.5}>
            {field('carcassMm', kind === 'cross' ? 'Divider' : 'Side panel')}
            {field('shelfMm', kind === 'corner' ? 'Top or bottom' : 'Shelf')}
          </Stack>
          {field('clearanceMm', 'Clearance per side', '0 is a press fit on the X2D, 0.1 slides freely.')}

          <Stack direction="row" spacing={1.5}>
            {field('carcassLengthMm', kind === 'cross' ? 'Along divider' : 'Along side panel')}
            {field('shelfLengthMm', kind === 'corner' ? 'Along top' : 'Along shelf')}
          </Stack>
          <Stack direction="row" spacing={1.5}>
            {field('depthMm', 'Slot depth')}
            {field('wallMm', 'Wall')}
            {field('floorMm', 'Floor')}
          </Stack>

          <FormControlLabel
            control={<Switch checked={holes} onChange={event => setHoles(event.target.checked)} />}
            label={`${JIG_HOLE_MM} mm holes to tack it in place`}
          />
          {holes && !problem && !jigHolesFit(spec) && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Too short for holes; it will be made without them.
            </Typography>
          )}

          {problem && <Alert severity="error">{problem}</Alert>}
          {offPlate && (
            <Alert severity="warning">
              {Math.round(footX)} × {Math.round(footY)} mm is larger than the {plateMm[0]} × {plateMm[1]} mm plate.
              Print two shorter jigs per joint instead.
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
