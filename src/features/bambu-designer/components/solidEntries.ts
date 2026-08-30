// Solids palette data, kept out of the component so fast refresh stays clean.
import ViewInArRoundedIcon from '@mui/icons-material/ViewInArRounded'
import CircleRoundedIcon from '@mui/icons-material/CircleRounded'
import ChangeHistoryRoundedIcon from '@mui/icons-material/ChangeHistoryRounded'
import PanoramaFishEyeRoundedIcon from '@mui/icons-material/PanoramaFishEyeRounded'
import DonutLargeRoundedIcon from '@mui/icons-material/DonutLargeRounded'
import SignalCellular4BarRoundedIcon from '@mui/icons-material/SignalCellular4BarRounded'
import TextFieldsRoundedIcon from '@mui/icons-material/TextFieldsRounded'
import type { SvgIconComponent } from '@mui/icons-material'
import type { SolidKind } from '../../../model/document.ts'

export type SolidPaletteKind = SolidKind | 'text'

export interface SolidEntry {
  kind: SolidPaletteKind
  label: string
  hint: string
  icon: SvgIconComponent
}

export const SOLIDS: readonly SolidEntry[] = [
  { kind: 'box', label: 'Box', hint: '20 mm cube', icon: ViewInArRoundedIcon },
  { kind: 'cylinder', label: 'Cylinder', hint: 'r 10 × 20 mm', icon: CircleRoundedIcon },
  { kind: 'sphere', label: 'Sphere', hint: 'r 10 mm', icon: PanoramaFishEyeRoundedIcon },
  { kind: 'cone', label: 'Cone', hint: 'r 10 × 20 mm', icon: ChangeHistoryRoundedIcon },
  { kind: 'torus', label: 'Torus', hint: 'r 12, tube 4', icon: DonutLargeRoundedIcon },
  { kind: 'wedge', label: 'Wedge', hint: '20 mm', icon: SignalCellular4BarRoundedIcon },
  { kind: 'text', label: 'Text', hint: 'extruded outlines', icon: TextFieldsRoundedIcon },
]
