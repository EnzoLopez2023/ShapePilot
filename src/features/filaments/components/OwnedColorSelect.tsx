// A colour picked from the filaments the account owns.
//
// Shared by every designer that paints a body in a real spool's colour: the
// Bambu designer's parts, the keycap tray's nameplate and posts. `value` is the
// chosen colour's catalogue key; a caller that only holds a hex resolves it to
// a key first.
import type { ReactNode } from 'react'
import { Autocomplete, Stack, TextField, Typography } from '@mui/material'
import { Swatch } from './Swatch.tsx'
import type { OwnedColor } from '../useOwnedColors.ts'

export interface OwnedColorSelectProps {
  label: string
  colors: readonly OwnedColor[]
  /** Catalogue key, or null for no colour chosen. */
  value: string | null
  onChange: (color: OwnedColor | null) => void
  /** Extra text after a colour's name in the list -- e.g. which AMS tray holds it. */
  note?: (color: OwnedColor) => ReactNode
}

export default function OwnedColorSelect(
  { label, colors, value, onChange, note }: OwnedColorSelectProps,
) {
  const current = colors.find(color => color.key === value) ?? null
  return (
    <Autocomplete<OwnedColor>
      size="small"
      options={[...colors]}
      value={current}
      onChange={(_event, choice) => onChange(choice)}
      getOptionLabel={color => color.label}
      isOptionEqualToValue={(a, b) => a.key === b.key}
      renderOption={(props, color) => {
        const { key, ...rest } = props as typeof props & { key: string }
        return (
          <Stack key={key} component="li" {...rest} direction="row" spacing={1} alignItems="center">
            <Swatch hexes={color.hexes} />
            <Typography variant="body2">{color.label}</Typography>
            {note && (
              <Typography component="span" variant="body2" sx={{ color: 'text.secondary' }}>
                {note(color)}
              </Typography>
            )}
          </Stack>
        )
      }}
      renderInput={params => (
        <TextField
          {...params}
          label={label}
          placeholder="From your filaments"
          InputProps={{
            ...params.InputProps,
            startAdornment: current
              ? <Stack sx={{ pl: 0.5 }}><Swatch hexes={current.hexes} /></Stack>
              : params.InputProps.startAdornment,
          }}
        />
      )}
    />
  )
}
