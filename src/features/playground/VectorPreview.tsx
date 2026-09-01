// The proposed trace, shown exactly as it will export: the VectorDrawing
// serialized straight to an inline <svg>. Read-only -- Apply turns it into
// editable path objects, Discard drops it. Nothing has reached the document yet.
import { useMemo } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import type { PathCommand, VectorDrawing } from '../../../lib/contracts/vectorDrawing.ts'

export interface VectorPreviewProps {
  drawing: VectorDrawing
  notes: string
  busy?: boolean
  onApply: () => void
  onDiscard: () => void
}

const num = (v: number): string => {
  const s = v.toFixed(3)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/** Drawing space is y-up; SVG is y-down, so every y becomes `height - y`. */
function toPathData(commands: readonly PathCommand[], height: number): string {
  const y = (v: number) => num(height - v)
  const x = (v: number) => num(v)
  const parts: string[] = []
  for (const c of commands) {
    switch (c.cmd) {
      case 'M': parts.push(`M ${x(c.to[0])},${y(c.to[1])}`); break
      case 'L': parts.push(`L ${x(c.to[0])},${y(c.to[1])}`); break
      case 'C': parts.push(
        `C ${x(c.c1[0])},${y(c.c1[1])} ${x(c.c2[0])},${y(c.c2[1])} ${x(c.to[0])},${y(c.to[1])}`)
        break
      case 'Z': parts.push('Z'); break
    }
  }
  return parts.join(' ')
}

export default function VectorPreview(props: VectorPreviewProps) {
  const { drawing, notes, busy, onApply, onDiscard } = props

  const paths = useMemo(
    () => drawing.paths.map(p => ({
      key: p.id,
      d: toPathData(p.commands, drawing.heightMm),
      fill: p.fill ?? '#111111',
    })),
    [drawing])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, p: 2, gap: 1.5 }}>
      <Typography variant="h3">Proposed drawing</Typography>
      <Box
        sx={{
          flex: 1, minHeight: 0, display: 'grid', placeItems: 'center',
          border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: '#ffffff', p: 2,
        }}
      >
        <Box
          component="svg"
          role="img"
          aria-label="Traced drawing preview"
          viewBox={`0 0 ${num(drawing.widthMm)} ${num(drawing.heightMm)}`}
          sx={{ width: '100%', height: '100%', maxHeight: '100%', objectFit: 'contain' }}
        >
          {paths.map(p => (
            <path key={p.key} d={p.d} fill={p.fill} fillRule="evenodd" />
          ))}
        </Box>
      </Box>
      {notes && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{notes}</Typography>}
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {drawing.paths.length} {drawing.paths.length === 1 ? 'path' : 'paths'} ·{' '}
        {num(drawing.widthMm)} × {num(drawing.heightMm)} mm. Applying is one undo step.
      </Typography>
      <Stack direction="row" spacing={1}>
        <Button size="small" variant="contained" disabled={busy} onClick={onApply}>Apply</Button>
        <Button size="small" disabled={busy} onClick={onDiscard}>Discard</Button>
      </Stack>
    </Box>
  )
}
