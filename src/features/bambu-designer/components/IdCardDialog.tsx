// The Systainer ID card template: size, the words on it, how far they stand
// proud, and the two filaments. Every line is fitted to the card as it is
// typed, so what the dialog says is the size that will print.
import { useMemo, useState } from 'react'
import {
  Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  InputAdornment, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import type { SceneObject } from '../../../model/document.ts'
import type { OwnedColor } from '../../filaments/useOwnedColors.ts'
import type { AmsTrayState } from '../useAmsTrays.ts'
import type { CardPaint, CardSizeId, CardSpec, LogoBounds, LogoPlacement, MeasureText } from '../idCard.ts'
import { CARD_SIZES, RAISE_OPTIONS, layoutCard } from '../idCard.ts'
import FilamentSlotField from './FilamentSlotField.tsx'
import FilamentColorField from './FilamentColorField.tsx'

const MAX_LINES = 4

/** What fitting needs: the font's measure, and the logo's shape if it loaded. */
export interface CardKit {
  measure: MeasureText
  logoBounds: LogoBounds | null
}

export interface IdCardDialogProps {
  /** Null while closed. `editing` is true when it will replace a card in place. */
  initial: { spec: CardSpec; editing: boolean } | null
  /** Null while the font and logo are still loading. */
  kit: CardKit | null
  ams: AmsTrayState
  colors: readonly OwnedColor[]
  busy: boolean
  onApply: (spec: CardSpec) => void
  onClose: () => void
}

const mm = (value: number) => `${Math.round(value * 100) / 100}`

export default function IdCardDialog(props: IdCardDialogProps) {
  return (
    <Dialog open={Boolean(props.initial)} onClose={props.onClose} maxWidth="xs" fullWidth>
      {/* Remounted per opening, so each starts from the card it was opened on. */}
      {props.initial && <IdCardForm key={JSON.stringify(props.initial)} {...props} initial={props.initial} />}
    </Dialog>
  )
}

function IdCardForm({ initial, kit, ams, colors, busy, onApply, onClose }:
  IdCardDialogProps & { initial: NonNullable<IdCardDialogProps['initial']> }) {
  const [spec, setSpec] = useState<CardSpec>(initial.spec)
  const [maxText, setMaxText] = useState(String(initial.spec.maxTextMm))
  // A line added from the button is where the typing goes next.
  const [focusLine, setFocusLine] = useState(0)
  const patch = (next: Partial<CardSpec>) => setSpec(current => ({ ...current, ...next }))

  const maxValue = Number(maxText)
  const maxValid = Number.isFinite(maxValue) && maxValue >= 1 && maxValue <= 50
  const hasText = spec.lines.some(line => line.trim())
  const hasLogo = spec.logo !== 'none'

  // The same layout the card will be built from, with a stand-in for the logo
  // file: only its shape matters to where the text can go.
  const sizes = useMemo(() => {
    if (!kit || !maxValid) return null
    const logo = kit.logoBounds
      ? { asset: { hash: '', filename: '', byteLength: 0 }, bounds: kit.logoBounds, name: '' }
      : null
    const { lineSizesMm } = layoutCard({ ...spec, maxTextMm: maxValue }, kit.measure, logo)
    const out: (number | null)[] = []
    let next = 0
    for (const line of spec.lines) out.push(line.trim() ? lineSizesMm[next++] : null)
    return out
  }, [kit, spec, maxValid, maxValue])

  const setLine = (index: number, text: string) =>
    patch({ lines: spec.lines.map((line, i) => (i === index ? text : line)) })

  const paintFields = (label: string, key: 'card' | 'raised') => {
    const value = spec[key]
    const onPatch = (change: Partial<SceneObject>) => {
      const next: CardPaint = { ...value }
      if ('filamentSlot' in change) next.filamentSlot = change.filamentSlot
      if ('color' in change) next.color = change.color
      patch({ [key]: next })
    }
    return (
      <Stack spacing={1}>
        <Typography variant="subtitle2">{label}</Typography>
        <FilamentSlotField object={value} ams={ams} onPatch={onPatch} quiet />
        <FilamentColorField object={value} colors={colors} onPatch={onPatch} />
      </Stack>
    )
  }

  const canApply = Boolean(kit) && maxValid && (hasText || hasLogo) && !busy

  return (
    <form onSubmit={event => { event.preventDefault(); if (canApply) onApply({ ...spec, maxTextMm: maxValue }) }}>
      <DialogTitle>Systainer ID card</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <ToggleButtonGroup
            size="small" exclusive fullWidth value={spec.size} aria-label="Card size"
            onChange={(_e, value: CardSizeId | null) => value && patch({ size: value })}
          >
            {(Object.keys(CARD_SIZES) as CardSizeId[]).map(id => (
              <ToggleButton key={id} value={id} sx={{ flexDirection: 'column', lineHeight: 1.3 }}>
                <span>{CARD_SIZES[id].label.replace('Systainer³ ', '')}</span>
                <Typography component="span" variant="body2" sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                  {mm(CARD_SIZES[id].widthMm)} × {mm(CARD_SIZES[id].depthMm)} × {mm(CARD_SIZES[id].heightMm)}
                </Typography>
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          <Stack spacing={1}>
            {spec.lines.map((line, index) => {
              const size = sizes?.[index]
              return (
                <Stack key={index} direction="row" spacing={0.5} alignItems="flex-start">
                  <TextField
                    size="small" fullWidth label={spec.lines.length > 1 ? `Line ${index + 1}` : 'Text'}
                    value={line} autoFocus={index === focusLine}
                    onChange={event => setLine(index, event.target.value)}
                    helperText={size == null ? ' '
                      : size < 1 ? 'Too many lines to fit; this one is left off.'
                        : size < maxValue ? `Shrunk to ${mm(size)} mm to fit` : `${mm(size)} mm`}
                  />
                  {spec.lines.length > 1 && (
                    <IconButton
                      size="small" aria-label={`Remove line ${index + 1}`} sx={{ mt: 0.5 }}
                      onClick={() => patch({ lines: spec.lines.filter((_l, i) => i !== index) })}
                    ><CloseRoundedIcon fontSize="small" /></IconButton>
                  )}
                </Stack>
              )
            })}
            {spec.lines.length < MAX_LINES && (
              <Button
                size="small" startIcon={<AddRoundedIcon />} sx={{ alignSelf: 'flex-start' }}
                onClick={() => { setFocusLine(spec.lines.length); patch({ lines: [...spec.lines, ''] }) }}
              >
                Add line
              </Button>
            )}
          </Stack>

          <TextField
            size="small" label="Largest text size" value={maxText}
            onChange={event => setMaxText(event.target.value)}
            error={!maxValid}
            helperText={maxValid ? 'A line too long for the card comes out smaller.' : 'Between 1 and 50 mm.'}
            slotProps={{
              htmlInput: { inputMode: 'decimal' },
              input: { endAdornment: <InputAdornment position="end">mm</InputAdornment> },
            }}
          />

          <Stack spacing={0.5}>
            <Typography variant="subtitle2">Raised by</Typography>
            <ToggleButtonGroup
              size="small" exclusive fullWidth value={spec.raiseMm} aria-label="Raised by"
              onChange={(_e, value: number | null) => value !== null && patch({ raiseMm: value })}
            >
              {RAISE_OPTIONS.map(r => <ToggleButton key={r} value={r}>{r} mm</ToggleButton>)}
            </ToggleButtonGroup>
          </Stack>

          <Stack spacing={0.5}>
            <Typography variant="subtitle2">Logo</Typography>
            <ToggleButtonGroup
              size="small" exclusive fullWidth value={spec.logo} aria-label="Logo"
              onChange={(_e, value: LogoPlacement | null) => value && patch({ logo: value })}
            >
              <ToggleButton value="none">None</ToggleButton>
              <ToggleButton value="left">Left</ToggleButton>
              <ToggleButton value="right">Right</ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          {paintFields('Card', 'card')}
          {paintFields('Text and logo', 'raised')}
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
            {ams.trays === null ? 'No AMS report available, so trays are shown by number. ' : ''}
            Sync the filament list to the AMS in Bambu Studio so the numbers line up.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        {!kit && <CircularProgress size={18} sx={{ mr: 'auto', ml: 2 }} aria-label="Loading the font" />}
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={!canApply}>
          {initial.editing ? 'Update card' : 'Add card'}
        </Button>
      </DialogActions>
    </form>
  )
}
