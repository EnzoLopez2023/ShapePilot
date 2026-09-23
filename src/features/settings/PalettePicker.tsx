// The palette chooser on the Settings page.
//
// Built on native radio inputs rather than a custom widget: the group gets
// arrow-key movement, a single tab stop and correct announcements for free.
// Each option draws the palette as a small stack of rounded bands, darkest
// first, and under it the palette's own light and dark grounds with their
// accent, so what you pick is what the workbench will wear in either mode.
import { Box, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import { PALETTES } from '../../theme/palettes.ts'
import type { PaletteDefinition, ThemePaletteId } from '../../theme/palettes.ts'
import { EASE_IOS } from '../../theme/theme.ts'

export interface PalettePickerProps {
  value: ThemePaletteId
  onChange: (next: ThemePaletteId) => void
}

export default function PalettePicker({ value, onChange }: PalettePickerProps) {
  return (
    <Box
      role="radiogroup"
      aria-labelledby="palette-picker-label"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))',
        gap: 1.5,
      }}
    >
      {PALETTES.map(palette => (
        <PaletteOption
          key={palette.id}
          palette={palette}
          selected={palette.id === value}
          onSelect={() => onChange(palette.id)}
        />
      ))}
    </Box>
  )
}

function PaletteOption({ palette, selected, onSelect }: {
  palette: PaletteDefinition
  selected: boolean
  onSelect: () => void
}) {
  return (
    <Box
      component="label"
      sx={theme => ({
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        p: 1,
        borderRadius: `${theme.shape.borderRadius}px`,
        border: `1px solid ${selected ? theme.palette.primary.main : theme.palette.divider}`,
        boxShadow: selected ? `0 0 0 1px ${theme.palette.primary.main}` : 'none',
        backgroundColor: selected
          ? alpha(theme.palette.primary.main, 0.06)
          : theme.palette.background.paper,
        cursor: 'pointer',
        transition: `border-color 180ms ${EASE_IOS}, background-color 180ms ${EASE_IOS}`,
        '&:hover': { borderColor: theme.palette.text.secondary },
        // The input is visually hidden, so its focus ring is drawn on the card.
        '&:has(input:focus-visible)': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      })}
    >
      <Box
        component="input"
        type="radio"
        name="theme-palette"
        value={palette.id}
        checked={selected}
        onChange={onSelect}
        sx={{
          position: 'absolute', opacity: 0, width: 1, height: 1, m: 0, pointerEvents: 'none',
        }}
      />
      <Stack5 colours={palette.swatches} />
      <ModeStrip palette={palette} />
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, minHeight: 44 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body1" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
            {palette.name}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.35 }}>
            {palette.blurb}
          </Typography>
        </Box>
        {selected && (
          <CheckRoundedIcon aria-hidden fontSize="small" sx={{ color: 'primary.main', mt: 0.25 }} />
        )}
      </Box>
    </Box>
  )
}

/** The five seed colours as overlapping rounded bands, like a fanned deck. */
function Stack5({ colours }: { colours: readonly string[] }) {
  return (
    <Box aria-hidden sx={{ display: 'flex', flexDirection: 'column' }}>
      {colours.map((colour, i) => (
        <Box
          key={`${colour}-${i}`}
          sx={{
            height: 14,
            mt: i === 0 ? 0 : '-4px',
            borderRadius: '7px',
            backgroundColor: colour,
            // A hairline so a white band still reads on a white card.
            boxShadow: 'inset 0 0 0 1px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.12)',
            position: 'relative',
            zIndex: i,
          }}
        />
      ))}
    </Box>
  )
}

/** The palette as the workbench will actually show it: light half, dark half. */
function ModeStrip({ palette }: { palette: PaletteDefinition }) {
  return (
    <Box aria-hidden sx={{ display: 'flex', borderRadius: '6px', overflow: 'hidden', height: 22 }}>
      {(['light', 'dark'] as const).map(mode => {
        const t = palette[mode]
        return (
          <Box
            key={mode}
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              px: 0.75,
              backgroundColor: t.canvas,
              boxShadow: `inset 0 0 0 1px ${t.border}`,
            }}
          >
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: t.accent }} />
            <Box sx={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: t.textMuted, opacity: 0.6 }} />
          </Box>
        )
      })}
    </Box>
  )
}
