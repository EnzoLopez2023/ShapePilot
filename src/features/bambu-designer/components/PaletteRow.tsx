// One clickable row of a left-panel palette: icon, label, and the size or
// gesture underneath it. Shared so the solids and the ready-made parts below
// them look like one list rather than two conventions.
import { CircularProgress, Stack, Typography } from '@mui/material'
import type { SvgIconComponent } from '@mui/icons-material'

export interface PaletteRowProps {
  icon: SvgIconComponent
  label: string
  hint: string
  busy?: boolean
  disabled?: boolean
  onAdd: () => void
}

export default function PaletteRow({ icon: Icon, label, hint, busy, disabled, onAdd }: PaletteRowProps) {
  const inert = Boolean(busy || disabled)
  return (
    <Stack
      direction="row" alignItems="center" spacing={1}
      role="button" tabIndex={inert ? -1 : 0}
      aria-disabled={inert || undefined}
      onClick={() => { if (!inert) onAdd() }}
      onKeyDown={e => {
        if (inert) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAdd() }
      }}
      sx={{
        px: 1, py: 0.75, borderRadius: 1,
        cursor: inert ? 'default' : 'pointer',
        opacity: inert ? 0.6 : 1,
        '&:hover': { bgcolor: inert ? undefined : 'action.hover' },
      }}
    >
      {busy
        ? <CircularProgress size={18} />
        : <Icon sx={{ fontSize: 18, color: 'text.secondary' }} />}
      <Stack sx={{ minWidth: 0 }}>
        <Typography variant="body2">{label}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>
          {hint}
        </Typography>
      </Stack>
    </Stack>
  )
}
