// The AMS tray one part prints from.
//
// Choosing a tray also paints the part in that spool's colour, so the viewport
// looks like the print will. The tray's number is what the 3MF export writes;
// the colour is only a picture of it.
import { MenuItem, Stack, TextField, Typography } from '@mui/material'
import { Swatch } from '../../filaments/components/Swatch.tsx'
import type { SceneObject } from '../../../model/document.ts'
import type { AmsTray } from '../amsTrays.ts'
import { MAX_FILAMENT_SLOT, trayLabel } from '../amsTrays.ts'
import type { AmsTrayState } from '../useAmsTrays.ts'

const describe = (tray: AmsTray): string =>
  [tray.subBrand ?? tray.material, tray.remainingPercent === null ? null : `${tray.remainingPercent}%`]
    .filter(Boolean).join(' · ')

export interface FilamentSlotFieldProps {
  /** Only the two fields it edits, so a template can offer it before any part exists. */
  object: Pick<SceneObject, 'filamentSlot' | 'color'>
  ams: AmsTrayState
  onPatch: (patch: Partial<SceneObject>) => void
  /** Leave out the note about syncing Studio, where it is said once elsewhere. */
  quiet?: boolean
}

export default function FilamentSlotField({ object, ams, onPatch, quiet }: FilamentSlotFieldProps) {
  const trays = ams.trays
  const byslot = new Map(trays?.map(tray => [tray.slot, tray]))
  // Without a report every number is still a real filament in Studio's list.
  const options = trays ?? Array.from({ length: MAX_FILAMENT_SLOT }, (_, i) => ({ slot: i + 1 }))
  const chosen = object.filamentSlot
  // A chosen tray the report no longer lists stays selectable, so the field
  // never shows a value it has no option for.
  const missing = chosen !== undefined && trays !== null && !byslot.has(chosen)

  return (
    <Stack spacing={0.5}>
      <TextField
        select size="small" label="Filament"
        value={chosen ?? ''}
        slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        onChange={event => {
          const value = event.target.value as number | ''
          if (value === '') { onPatch({ filamentSlot: undefined }); return }
          const tray = byslot.get(value)
          onPatch({ filamentSlot: value, ...(tray?.color ? { color: tray.color } : {}) })
        }}
      >
        <MenuItem value="">Auto</MenuItem>
        {options.map(option => {
          const tray = byslot.get(option.slot)
          return (
            <MenuItem key={option.slot} value={option.slot}>
              <Stack direction="row" spacing={1} alignItems="center">
                {tray?.color && <Swatch hexes={[tray.color]} />}
                <span>{trayLabel(option.slot)}</span>
                {tray && (
                  <Typography component="span" variant="body2" sx={{ color: 'text.secondary' }}>
                    {describe(tray)}
                  </Typography>
                )}
              </Stack>
            </MenuItem>
          )
        })}
        {missing && (
          <MenuItem value={chosen}>{trayLabel(chosen)} (empty)</MenuItem>
        )}
      </TextField>
      {!quiet && <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
        {trays === null
          ? 'No AMS report available, so trays are shown by number. '
          : ''}
        Sync the filament list to the AMS in Bambu Studio so the numbers line up.
      </Typography>}
    </Stack>
  )
}
