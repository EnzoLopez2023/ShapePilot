// Pick any colour in the catalogue: for a roll bought without an invoice, or an
// invoice line the reader could not match.
import { Autocomplete, Stack, TextField } from '@mui/material'
import { FILAMENT_CATALOG, filamentByKey } from '../../../../lib/contracts/bambuFilaments.ts'
import type { FilamentColor } from '../../../../lib/contracts/bambuFilaments.ts'
import { colorLabel } from '../model/usage.ts'
import { Swatch } from './Swatch.tsx'

const lineLabel = (color: FilamentColor) => colorLabel(color.key).split(' · ')[0]

const OPTIONS = [...FILAMENT_CATALOG].sort((a, b) =>
  lineLabel(a).localeCompare(lineLabel(b)) || a.name.localeCompare(b.name))

export interface CatalogColorFieldProps {
  value: string | null
  onChange: (key: string | null) => void
  label: string
  /** The accessible name, when the visible label alone is ambiguous. */
  ariaLabel?: string
  size?: 'small' | 'medium'
  error?: boolean
}

export default function CatalogColorField({
  value, onChange, label, ariaLabel, size = 'small', error,
}: CatalogColorFieldProps) {
  const current = value ? filamentByKey(value) ?? null : null
  return (
    <Autocomplete<FilamentColor>
      size={size}
      options={OPTIONS}
      value={current}
      groupBy={lineLabel}
      getOptionLabel={color => `${color.name}${color.code ? ` ${color.code}` : ''}`}
      isOptionEqualToValue={(a, b) => a.key === b.key}
      onChange={(_event, color) => onChange(color?.key ?? null)}
      renderOption={(props, color) => {
        const { key, ...rest } = props as typeof props & { key: string }
        return (
          <Stack component="li" key={key} direction="row" {...rest} sx={{ gap: 1, alignItems: 'center' }}>
            <Swatch hexes={color.hexes} discontinued={color.discontinued} />
            {color.name}{color.code ? ` ${color.code}` : ''}
          </Stack>
        )
      }}
      renderInput={params => (
        <TextField
          {...params}
          label={label}
          error={error}
          slotProps={{
            htmlInput: { ...params.inputProps, ...(ariaLabel ? { 'aria-label': ariaLabel } : {}) },
            input: {
              ...params.InputProps,
              startAdornment: current
                ? <Stack sx={{ pl: 0.5 }}><Swatch hexes={current.hexes} /></Stack>
                : params.InputProps.startAdornment,
            },
          }}
        />
      )}
    />
  )
}
