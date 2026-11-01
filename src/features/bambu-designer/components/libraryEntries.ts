// Parts that ship with the app, as opposed to the parametric solids beside
// them. Three kinds:
//
// - a file under public/models, fetched on first use, then stored and
//   referenced exactly like a hand-imported file -- so a design that uses one
//   travels to another device the same way;
// - a hardware cutter, generated from a size table (see ../hardware.ts), which
//   asks for its size and the thickness it cuts before it is added;
// - a template, which lays out several ordinary parts at once from a dialog
//   (see ../idCard.ts);
// - a woodworking jig, sized to the panels it holds from a dialog (see
//   ../jig.ts), or a run of clamping squares (see ../clampSquare.ts).
import WorkspacePremiumRoundedIcon from '@mui/icons-material/WorkspacePremiumRounded'
import HardwareRoundedIcon from '@mui/icons-material/HardwareRounded'
import AdjustRoundedIcon from '@mui/icons-material/AdjustRounded'
import HexagonOutlinedIcon from '@mui/icons-material/HexagonOutlined'
import BadgeRoundedIcon from '@mui/icons-material/BadgeRounded'
import BorderBottomRoundedIcon from '@mui/icons-material/BorderBottomRounded'
import BorderStyleRoundedIcon from '@mui/icons-material/BorderStyleRounded'
import ChangeHistoryRoundedIcon from '@mui/icons-material/ChangeHistoryRounded'
import type { SvgIconComponent } from '@mui/icons-material'
import type { ImportFormat } from '../../../model/document.ts'
import type { FastenerKind } from '../hardware.ts'
import { FASTENER_HINTS, FASTENER_LABELS } from '../hardware.ts'
import type { JigKind } from '../jig.ts'
import { JIG_LABELS } from '../jig.ts'

interface EntryBase {
  id: string
  label: string
  hint: string
  icon: SvgIconComponent
}

export interface FileEntry extends EntryBase {
  kind: 'file'
  /** Served from public/, so it is fetched, never bundled. */
  url: string
  /** What the object is called, and the name the asset is stored under. */
  filename: string
  format: ImportFormat
}

export interface FastenerEntry extends EntryBase {
  kind: 'fastener'
  fastener: FastenerKind
}

export interface TemplateEntry extends EntryBase {
  kind: 'template'
  template: 'id-card'
}

export interface JigEntry extends EntryBase {
  kind: 'jig'
  jig: JigKind
}

export interface ClampSquareEntry extends EntryBase {
  kind: 'clamp-square'
}

export type LibraryEntry = FileEntry | FastenerEntry | TemplateEntry | JigEntry | ClampSquareEntry

const FASTENER_ICONS: Record<FastenerKind, SvgIconComponent> = {
  'clearance': HardwareRoundedIcon,
  'countersunk': HardwareRoundedIcon,
  'counterbored': HardwareRoundedIcon,
  'insert': AdjustRoundedIcon,
  'nut-trap': HexagonOutlinedIcon,
}

const fastener = (kind: FastenerKind): FastenerEntry => ({
  kind: 'fastener',
  id: `fastener-${kind}`,
  label: FASTENER_LABELS[kind],
  hint: FASTENER_HINTS[kind],
  icon: FASTENER_ICONS[kind],
  fastener: kind,
})

export interface LibraryGroup {
  label: string
  entries: readonly LibraryEntry[]
}

/** The logo is also what the ID card template puts beside the text. */
export const EL_LOGO: FileEntry = {
  kind: 'file',
  id: 'el-logo-badge',
  label: 'EL logo badge',
  hint: '35.7 × 31.9 × 1.5 mm',
  icon: WorkspacePremiumRoundedIcon,
  url: '/models/el-logo-badge.stl',
  filename: 'el-logo-badge.stl',
  format: 'stl',
}

export const LIBRARY: readonly LibraryGroup[] = [
  {
    label: 'Templates',
    entries: [
      {
        kind: 'template',
        id: 'template-id-card',
        label: 'Systainer ID card',
        hint: 'S76 or M, raised text and logo',
        icon: BadgeRoundedIcon,
        template: 'id-card',
      },
    ],
  },
  {
    label: 'Woodworking jigs',
    entries: [
      { kind: 'jig', id: 'jig-tee', label: JIG_LABELS.tee, hint: 'shelf to side panel, any thicknesses', icon: BorderBottomRoundedIcon, jig: 'tee' },
      { kind: 'jig', id: 'jig-corner', label: JIG_LABELS.corner, hint: 'butt corner, any thicknesses', icon: BorderStyleRoundedIcon, jig: 'corner' },
      { kind: 'clamp-square', id: 'clamp-square', label: 'Clamping squares', hint: 'hold an inside corner at 90°', icon: ChangeHistoryRoundedIcon },
    ],
  },
  {
    label: 'Hardware',
    entries: (['clearance', 'countersunk', 'counterbored', 'insert', 'nut-trap'] as const).map(fastener),
  },
  {
    label: 'Models',
    entries: [EL_LOGO],
  },
]
