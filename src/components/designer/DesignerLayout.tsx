// The workbench frame every designer shares: a toolbar row over a three-column
// grid, with the canvas re-ordered first on a narrow screen. The column widths
// and breakpoints are the ones DESIGN.md records for the keycap workbench, so
// the sub-apps read as one product rather than three.
import type { ReactNode } from 'react'
import { Box, Paper, Stack } from '@mui/material'

const panel = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  overflow: 'hidden',
} as const

export interface DesignerLayoutProps {
  label: string
  toolbar: ReactNode
  left: ReactNode
  canvas: ReactNode
  right: ReactNode
  /** Bottom-left status line over the canvas; announced politely. */
  status?: ReactNode
}

export default function DesignerLayout(props: DesignerLayoutProps) {
  const { label, toolbar, left, canvas, right, status } = props
  return (
    <Box
      component="section"
      aria-label={label}
      sx={{
        display: 'grid', gap: 1.5,
        gridTemplateRows: 'auto minmax(0, 1fr)',
        height: '100%', minHeight: 0,
      }}
    >
      <Paper component="header" elevation={0} sx={{ p: 1, ...panel }}>
        {toolbar}
      </Paper>

      <Box
        sx={{
          display: 'grid', gap: 1.5, minHeight: 0,
          gridTemplateColumns: {
            xs: '1fr',
            md: '220px minmax(0, 1fr)',
            lg: '220px minmax(0, 1fr) 312px',
          },
          gridTemplateRows: { xs: 'minmax(360px, 55vh) auto auto', md: 'minmax(0, 1fr)' },
        }}
      >
        <Paper
          elevation={0}
          sx={{ ...panel, p: 1.5, order: { xs: 2, md: 0 }, overflowY: 'auto' }}
        >
          {left}
        </Paper>

        <Paper
          elevation={0}
          sx={{
            ...panel, position: 'relative', order: { xs: 1, md: 0 },
            bgcolor: 'background.default',
          }}
        >
          {canvas}
          {status && (
            <Stack
              aria-live="polite"
              sx={{
                position: 'absolute', left: 12, bottom: 10, pointerEvents: 'none',
                color: 'text.secondary', fontSize: '0.75rem',
              }}
            >
              {status}
            </Stack>
          )}
        </Paper>

        <Paper
          elevation={0}
          sx={{
            ...panel, p: 1.5, order: { xs: 3, md: 0 }, overflowY: 'auto',
            display: { xs: 'flex', md: 'none', lg: 'flex' },
          }}
        >
          {right}
        </Paper>
      </Box>
    </Box>
  )
}
