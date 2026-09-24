// Parts that ship with the app, as opposed to the parametric solids beside
// them. Three kinds:
//
// - a file under public/models, fetched on first use, then stored and
//   referenced exactly like a hand-imported file -- so a design that uses one
//   travels to another device the same way;
// - a hardware cutter, generated from a size table (see ../hardware.ts), which
//   asks for its size and the thickness it cuts before it is added;
// - a template, which lays out several ordinary parts at once from a dialog
//   (see ../idCard.ts).
import WorkspacePremiumRoundedIcon from '@mui/icons-material/WorkspacePremiumRounded'
import HardwareRoundedIcon from '@mui/icons-material/HardwareRounded'
import AdjustRoundedIcon from '@mui/icons-material/AdjustRounded'
import HexagonOutlinedIcon from '@mui/icons-material/HexagonOutlined'
import BadgeRoundedIcon from '@mui/icons-material/BadgeRounded'
import type { SvgIconComponent } from '@mui/icons-material'
import type { ImportFormat } from '../../../model/document.ts'
import type { FastenerKind } from '../hardware.ts'
import { FASTENER_HINTS, FASTENER_LABELS } from '../hardware.ts'

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

export type LibraryEntry = FileEntry | FastenerEntry | TemplateEntry

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
    label: 'Hardware',
    entries: (['clearance', 'countersunk', 'counterbored', 'insert', 'nut-trap'] as const).map(fastener),
  },
  {
    label: 'Models',
    entries: [EL_LOGO],
  },
]
