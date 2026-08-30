// Palette data, kept out of the component module so fast refresh keeps working
// (react-refresh only handles files that export components alone).
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined'
import SquareOutlinedIcon from '@mui/icons-material/SquareOutlined'
import RectangleOutlinedIcon from '@mui/icons-material/RectangleOutlined'
import ChangeHistoryOutlinedIcon from '@mui/icons-material/ChangeHistoryOutlined'
import HexagonOutlinedIcon from '@mui/icons-material/HexagonOutlined'
import TextFieldsRoundedIcon from '@mui/icons-material/TextFieldsRounded'
import type { SvgIconComponent } from '@mui/icons-material'
import type { Shape2DKind } from '../../../model/document.ts'

export type PaletteKind = Shape2DKind | 'text'

export interface PaletteEntry {
  kind: PaletteKind
  label: string
  hint: string
  icon: SvgIconComponent
}

export const PALETTE: readonly PaletteEntry[] = [
  { kind: 'circle', label: 'Circle', hint: 'r 15 mm', icon: CircleOutlinedIcon },
  { kind: 'square', label: 'Square', hint: '30 mm', icon: SquareOutlinedIcon },
  { kind: 'rect', label: 'Rectangle', hint: '40 × 25 mm', icon: RectangleOutlinedIcon },
  { kind: 'triangle', label: 'Triangle', hint: '30 × 26 mm', icon: ChangeHistoryOutlinedIcon },
  { kind: 'polygon', label: 'Polygon', hint: '6 sides', icon: HexagonOutlinedIcon },
  { kind: 'text', label: 'Text', hint: 'cut as outlines', icon: TextFieldsRoundedIcon },
]
