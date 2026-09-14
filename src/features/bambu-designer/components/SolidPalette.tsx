// Drag a solid onto the workplane, or click to drop it at the origin -- the
// Tinkercad gesture, and the same palette pattern the keycap tray uses.
import { Stack, ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { ObjectMode } from '../../../model/document.ts'
import PaletteRow from './PaletteRow.tsx'
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
        {SOLIDS.map(entry => (
          <PaletteRow
            key={entry.kind}
            icon={entry.icon}
            label={entry.label}
            hint={entry.hint}
            onAdd={() => onAdd(entry.kind)}
          />
        ))}
      </Stack>
    </Stack>
  )
}
