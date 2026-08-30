// The objects palette. Same pattern as the keycap PocketPalette: each row is
// click-to-add and also a drag source carrying an application/json payload the
// canvas drop handler parses.
import { Stack, Typography } from '@mui/material'
import type { PaletteKind } from './paletteEntries.ts'
import { PALETTE } from './paletteEntries.ts'

export interface ShapePaletteProps {
  onAdd: (kind: PaletteKind) => void
  /** Shown under the Text row when no font is available to trace outlines. */
  textUnavailableReason?: string
}

export default function ShapePalette({ onAdd, textUnavailableReason }: ShapePaletteProps) {
  return (
    <Stack spacing={0.25} role="list" aria-label="Shapes">
      {PALETTE.map(entry => {
        const Icon = entry.icon
        const disabled = entry.kind === 'text' && Boolean(textUnavailableReason)
        return (
          <Stack
            key={entry.kind}
            direction="row"
            alignItems="center"
            spacing={1}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            draggable={!disabled}
            onDragStart={e => {
              e.dataTransfer.setData('application/json', JSON.stringify({ kind: entry.kind }))
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => { if (!disabled) onAdd(entry.kind) }}
            onKeyDown={e => {
              if (disabled) return
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAdd(entry.kind) }
            }}
            sx={{
              px: 1, py: 0.75, borderRadius: 1,
              cursor: disabled ? 'not-allowed' : 'grab',
              opacity: disabled ? 0.5 : 1,
              '&:hover': { bgcolor: disabled ? 'transparent' : 'action.hover' },
            }}
          >
            <Icon sx={{ fontSize: 18, color: 'text.secondary' }} />
            <Stack sx={{ minWidth: 0 }}>
              <Typography variant="body2">{entry.label}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>
                {disabled ? textUnavailableReason : entry.hint}
              </Typography>
            </Stack>
          </Stack>
        )
      })}
    </Stack>
  )
}
