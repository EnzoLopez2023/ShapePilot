// Parts that ship with the app, as opposed to the parametric solids beside
// them. Each one is a file under public/models fetched on first use, then
// stored and referenced exactly like a hand-imported file -- so a design that
// uses one travels to another device the same way.
import WorkspacePremiumRoundedIcon from '@mui/icons-material/WorkspacePremiumRounded'
import type { SvgIconComponent } from '@mui/icons-material'
import type { ImportFormat } from '../../../model/document.ts'

export interface LibraryEntry {
  id: string
  label: string
  hint: string
  icon: SvgIconComponent
  /** Served from public/, so it is fetched, never bundled. */
  url: string
  /** What the object is called, and the name the asset is stored under. */
  filename: string
  format: ImportFormat
}

export const LIBRARY: readonly LibraryEntry[] = [
  {
    id: 'el-logo-badge',
    label: 'EL logo badge',
    hint: '35.7 × 31.9 × 1.5 mm',
    icon: WorkspacePremiumRoundedIcon,
    url: '/models/el-logo-badge.stl',
    filename: 'el-logo-badge.stl',
    format: 'stl',
  },
]
