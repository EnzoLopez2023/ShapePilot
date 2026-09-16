import { Box } from '@mui/material'

/**
 * The colour, as a dot rather than a squircle -- a 14px radius on an 18px chip
 * is a circle anyway, so it is drawn as one deliberately. The ring is
 * structural, not decoration: Jade White is `#FFFFFF` on a white surface and
 * several of the darks are near-black on the dark ground, so without it those
 * swatches simply are not there. A dual-colour filament is drawn as a split.
 */
export function Swatch({ hexes, discontinued }: { hexes: readonly string[]; discontinued?: true }) {
  const background = hexes.length > 1
    ? `linear-gradient(135deg, ${hexes[0]} 0 50%, ${hexes[1]} 50% 100%)`
    : hexes[0]
  return (
    <Box
      aria-hidden
      sx={{
        width: 18,
        height: 18,
        flexShrink: 0,
        borderRadius: '50%',
        background,
        border: '1px solid',
        borderColor: 'divider',
        opacity: discontinued ? 0.55 : 1,
      }}
    />
  )
}
