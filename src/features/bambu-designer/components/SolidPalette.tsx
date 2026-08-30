// Drag a solid onto the workplane, or click to drop it at the origin -- the
// Tinkercad gesture, and the same palette pattern the keycap tray uses.
import { Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import type { ObjectMode } from '../../../model/document.ts'
import type { SolidPaletteKind } from './solidEntries.ts'
import { SOLIDS } from './solidEntries.ts'

export interface SolidPaletteProps {
  mode: ObjectMode
  onModeChange: (mode: ObjectMode) => void
  onAdd: (kind: SolidPaletteKind) => void
}

export default function SolidPalette({ mode, onModeChange, onAdd }: SolidPaletteProps) {
  return (
    <Stack spacing={1}>
      <ToggleButtonGroup
        size="small" exclusive fullWidth value={mode}
        onChange={(_e, value: ObjectMode | null) => value && onModeChange(value)}
        aria-label="Add as solid or hole"
      >
        <ToggleButton value="solid" aria-label="Add as solid">Solid</ToggleButton>
        <ToggleButton value="hole" aria-label="Add as hole">Hole</ToggleButton>
      </ToggleButtonGroup>

      <Stack spacing={0.25} role="list" aria-label="Solids">
        {SOLIDS.map(entry => {
          const Icon = entry.icon
          return (
            <Stack
              key={entry.kind}
              direction="row" alignItems="center" spacing={1}
              role="button" tabIndex={0}
              onClick={() => onAdd(entry.kind)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAdd(entry.kind) }
              }}
              sx={{
                px: 1, py: 0.75, borderRadius: 1, cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Icon sx={{ fontSize: 18, color: 'text.secondary' }} />
              <Stack sx={{ minWidth: 0 }}>
                <Typography variant="body2">{entry.label}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>
                  {entry.hint}
                </Typography>
              </Stack>
            </Stack>
          )
        })}
      </Stack>
    </Stack>
  )
}
