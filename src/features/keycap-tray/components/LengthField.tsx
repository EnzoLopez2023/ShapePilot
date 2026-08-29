import { useEffect, useState } from 'react'
import { TextField, Tooltip } from '@mui/material'
import type { TextFieldProps } from '@mui/material'
import { formatLength, parseLength } from '../model/units.ts'

export interface LengthFieldProps {
  label: string
  valueMm: number
  onChangeMm: (mm: number) => void
  imperial: boolean
  hint?: string
  sx?: TextFieldProps['sx']
}

/**
 * A length input that reads/writes millimetres but displays either mm or a
 * fractional-inch string, depending on the designer's unit toggle. Keeps a
 * local text buffer so typing "1-3/8" doesn't get reformatted mid-keystroke;
 * it only commits (and reformats) on blur or Enter.
 */
export default function LengthField({ label, valueMm, onChangeMm, imperial, hint, sx }: LengthFieldProps) {
  const [text, setText] = useState(() => formatLength(valueMm, imperial))
  const [edited, setEdited] = useState(false)

  // Re-sync when the value changes elsewhere (undo, another field, the unit
  // toggle) -- but not while the user is actively typing this field.
  useEffect(() => {
    setText(formatLength(valueMm, imperial))
    setEdited(false)
  }, [valueMm, imperial])

  const commit = () => {
    if (!edited) return
    const parsed = parseLength(text, imperial)
    if (parsed != null) onChangeMm(parsed)
    else setText(formatLength(valueMm, imperial))
    setEdited(false)
  }

  const input = (
    <TextField
      size="small" label={label} sx={sx}
      value={text}
      onChange={e => { setText(e.target.value); setEdited(true) }}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      placeholder={imperial ? 'e.g. 1-3/8"' : undefined}
      slotProps={{ htmlInput: { inputMode: 'decimal', 'aria-label': label } }}
    />
  )
  return hint ? <Tooltip title={hint}>{input}</Tooltip> : input
}
