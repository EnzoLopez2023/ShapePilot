// A part's colour, taken from the filaments the account actually owns.
//
// The AMS field beside this one says which tray a part prints from, which is
// only answerable while the printer is reachable and the spool is loaded. This
// is the other half: the shelf. Picking a colour here is presentation -- it
// never reaches an exporter -- but it is what makes a two-colour design legible
// before it is sliced.
import { Autocomplete, Stack, TextField, Typography } from '@mui/material'
import { Swatch } from '../../filaments/components/Swatch.tsx'
import type { SceneObject } from '../../../model/document.ts'
import type { OwnedColor } from '../useOwnedColors.ts'

export default function FilamentColorField({ object, colors, onPatch }: {
  object: SceneObject
  colors: readonly OwnedColor[]
  onPatch: (patch: Partial<SceneObject>) => void
}) {
  if (!colors.length) return null
  // Matched by hex, because that is all the object carries: a colour picked
  // here and the same colour picked from an AMS tray are the same value.
  const current = colors.find(
    color => color.hexes[0].toUpperCase() === (object.color ?? '').toUpperCase()) ?? null

  return (
    <Autocomplete<OwnedColor>
      size="small"
      options={[...colors]}
      value={current}
      onChange={(_event, choice) => onPatch({ color: choice?.hexes[0] })}
      getOptionLabel={color => color.label}
      isOptionEqualToValue={(a, b) => a.key === b.key}
      renderOption={(props, color) => {
        const { key, ...rest } = props as typeof props & { key: string }
        return (
          <Stack key={key} component="li" {...rest} direction="row" spacing={1} alignItems="center">
            <Swatch hexes={color.hexes} />
            <Typography variant="body2">{color.label}</Typography>
          </Stack>
        )
      }}
      renderInput={params => (
        <TextField {...params} label="Colour" placeholder="From your filaments" />
      )}
    />
  )
}
