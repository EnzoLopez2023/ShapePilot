// Panel stands, asked as they are added: the panel they hold, how many, and
// the label raised on the base. The label follows the thickness until it is
// typed over, so the usual case -- label it with its size -- takes no typing.
import { useState } from 'react'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, InputAdornment,
  Stack, Switch, TextField, Typography,
} from '@mui/material'
import type { SceneObject } from '../../../model/document.ts'
import type { OwnedColor } from '../../filaments/useOwnedColors.ts'
import type { AmsTrayState } from '../useAmsTrays.ts'
import type { PanelStandSpec, StandPaint } from '../panelStand.ts'
import { panelLabel, panelStandLayout, panelStandProblem } from '../panelStand.ts'
import FilamentSlotField from './FilamentSlotField.tsx'
import FilamentColorField from './FilamentColorField.tsx'

export interface PanelStandColours {
  stand: StandPaint
  label: StandPaint
}

export interface PanelStandDialogProps {
  /** What to start from; null keeps the dialog closed. */
  initial: { spec: PanelStandSpec; colours: PanelStandColours } | null
  /** The plate, x by y, to warn when the stands will not fit on it. */
  plateMm: readonly [number, number]
  ams: AmsTrayState
  colors: readonly OwnedColor[]
  onAdd: (spec: PanelStandSpec, colours: PanelStandColours) => void
  onClose: () => void
}

export default function PanelStandDialog({ initial, ...rest }: PanelStandDialogProps) {
  return (
    <Dialog open={Boolean(initial)} onClose={rest.onClose} maxWidth="xs" fullWidth>
      {initial && <PanelStandForm initial={initial} {...rest} />}
    </Dialog>
  )
}

type NumberKey = 'panelMm' | 'clearanceMm' | 'depthMm' | 'raiseMm' | 'count'
const NUMBER_KEYS: NumberKey[] = ['panelMm', 'clearanceMm', 'depthMm', 'raiseMm', 'count']

const inches = (mm: number) => `≈ ${(mm / 25.4).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} in`

function PanelStandForm({ initial, plateMm, ams, colors, onAdd, onClose }:
  Omit<PanelStandDialogProps, 'initial'> & { initial: NonNullable<PanelStandDialogProps['initial']> }) {
  const [text, setText] = useState(() =>
    Object.fromEntries(NUMBER_KEYS.map(k => [k, String(initial.spec[k])])) as Record<NumberKey, string>)
  const [labelled, setLabelled] = useState(Boolean(initial.spec.label.trim()))
  // A label that reads the thickness keeps following it until it is typed over.
  const [label, setLabel] = useState<string | null>(
    initial.spec.label === panelLabel(initial.spec.panelMm) ? null : initial.spec.label)
  const [colours, setColours] = useState(initial.colours)

  const numbers = Object.fromEntries(
    NUMBER_KEYS.map(k => [k, text[k].trim() === '' ? NaN : Number(text[k])]),
  ) as Record<NumberKey, number>
  const spec: PanelStandSpec = {
    ...numbers,
    label: labelled ? (label ?? panelLabel(numbers.panelMm)) : '',
  }
  const problem = panelStandProblem(spec)
  const [footX, footY] = problem ? [0, 0] : panelStandLayout(spec, plateMm[0]).footprintMm
  const offPlate = !problem && (footX > plateMm[0] || footY > plateMm[1])

  const field = (key: NumberKey, label: string, unit: string | null, helper?: string) => (
    <TextField
      size="small" label={label} value={text[key]} fullWidth
      onChange={event => setText(t => ({ ...t, [key]: event.target.value }))}
      helperText={helper}
      slotProps={{
        htmlInput: { inputMode: unit ? 'decimal' : 'numeric' },
        input: unit ? { endAdornment: <InputAdornment position="end">{unit}</InputAdornment> } : undefined,
      }}
    />
  )

  const paintFields = (title: string, key: keyof PanelStandColours) => {
    const value = colours[key]
    const onPatch = (change: Partial<SceneObject>) => {
      const next: StandPaint = { ...value }
      if ('filamentSlot' in change) next.filamentSlot = change.filamentSlot
      if ('color' in change) next.color = change.color
      setColours(c => ({ ...c, [key]: next }))
    }
    return (
      <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle2">{title}</Typography>
        <FilamentSlotField object={value} ams={ams} onPatch={onPatch} quiet />
        <FilamentColorField object={value} colors={colors} trays={ams.trays} onPatch={onPatch} />
      </Stack>
    )
  }

  return (
    <form onSubmit={event => { event.preventDefault(); if (!problem) onAdd(spec, colours) }}>
      <DialogTitle>Panel stands</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Drop a panel's edge into the slot to stand it upright for edge banding or finishing. Enter the
            thickness as measured; the clearance is added to each side of the slot.
          </Typography>
          <Stack direction="row" spacing={1.5}>
            {field('panelMm', 'Panel thickness', 'mm', Number.isFinite(numbers.panelMm) ? inches(numbers.panelMm) : undefined)}
            {field('clearanceMm', 'Clearance', 'mm', 'per side')}
          </Stack>
          <Stack direction="row" spacing={1.5}>
            {field('depthMm', 'Depth', 'mm', 'the print height')}
            {field('count', 'How many', null)}
          </Stack>

          <FormControlLabel
            control={<Switch checked={labelled} onChange={event => setLabelled(event.target.checked)} />}
            label="Raised label on the base"
          />
          {labelled && (
            <Stack direction="row" spacing={1.5}>
              <TextField
                size="small" label="Label" fullWidth
                value={label ?? panelLabel(numbers.panelMm)}
                onChange={event => setLabel(event.target.value)}
                helperText={label === null ? 'follows the thickness' : 'sized to fit the base'}
              />
              {field('raiseMm', 'Raised', 'mm')}
            </Stack>
          )}

          <Stack direction="row" spacing={1.5}>
            {paintFields('Stand', 'stand')}
            {labelled && paintFields('Label', 'label')}
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
