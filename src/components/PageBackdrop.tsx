// A full-bleed environmental photograph behind an orienting screen, quieted by
// a veil mixed from the active page ground.
//
// This is the one place the workbench borrows the nintek-family landing move:
// image to the edges, a palette-matched veil over it, and every working surface
// floating on top as opaque paper. It is scoped to screens that orient rather
// than screens that are worked in -- the Home page and the keycap-tray project
// gate -- so a technical drawing never has a photograph fighting it. The veil
// is derived from `background.default`, so it tracks light and dark without a
// second asset, and the layer is inert to the pointer and to assistive tech.
import { Box } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'

export interface PageBackdropProps {
  /** File stem under `public/backgrounds/` (`home` -> `/backgrounds/home.jpg`). */
  name: string
}

export function PageBackdrop({ name }: PageBackdropProps) {
  const theme = useTheme()
  const ground = theme.palette.background.default
  const dark = theme.palette.mode === 'dark'
  // The Matched Veil: a diagonal wash from the page ground. Opaque enough that
  // bare headings clear their contrast target, sheer enough that the room
  // stays legible under the floating paper.
  const veil = `linear-gradient(135deg, ${alpha(ground, dark ? 0.86 : 0.7)} 0%, ${
    alpha(ground, dark ? 0.96 : 0.9)
  } 100%)`

  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        // Slightly overscanned so a parallax-free fixed crop never shows an edge.
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: '-2%',
          backgroundImage: `url(/backgrounds/${name}.jpg)`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        },
        '&::after': {
          content: '""',
          position: 'absolute',
          inset: 0,
          background: veil,
        },
      }}
    />
  )
}
