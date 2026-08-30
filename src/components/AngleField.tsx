import { useEffect, useState } from 'react'
import { TextField, Tooltip } from '@mui/material'
import type { TextFieldProps } from '@mui/material'
import { normalizeAngleDeg } from '../geometry/vec.ts'

export interface AngleFieldProps {
  label?: string
  valueDeg: number
  onChangeDeg: (deg: number) => void
  hint?: string
  sx?: TextFieldProps['sx']
}

/**
 * Degrees in, degrees out, folded into [0, 360). Local text buffer so typing
 * "-45" or "370" isn't rewritten mid-keystroke; commits on blur or Enter.
 */
export default function AngleField({ label = 'Angle°', valueDeg, onChangeDeg, hint, sx }: AngleFieldProps) {
  const [text, setText] = useState(() => String(round(valueDeg)))
  const [edited, setEdited] = useState(false)

  useEffect(() => {
    setText(String(round(valueDeg)))
    setEdited(false)
  }, [valueDeg])

  const commit = () => {
    if (!edited) return
    const parsed = Number.parseFloat(text)
    if (Number.isFinite(parsed)) onChangeDeg(normalizeAngleDeg(parsed))
    else setText(String(round(valueDeg)))
    setEdited(false)
  }

  const input = (
    <TextField
      size="small" label={label} sx={sx}
      value={text}
      onChange={e => { setText(e.target.value); setEdited(true) }}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      slotProps={{ htmlInput: { inputMode: 'decimal', 'aria-label': 'Angle in degrees' } }}
    />
  )
  return hint ? <Tooltip title={hint}>{input}</Tooltip> : input
}

const round = (deg: number): number => Math.round(normalizeAngleDeg(deg) * 10) / 10
