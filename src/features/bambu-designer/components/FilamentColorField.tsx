// A part's colour, taken from the filaments the account actually owns.
//
// The AMS field beside this one says which tray a part prints from, which is
// only answerable while the printer is reachable and the spool is loaded. This
// is the other half: the shelf. Picking a colour here is presentation -- it
// never reaches an exporter -- but it is what makes a two-colour design legible
// before it is sliced.
import type { SceneObject } from '../../../model/document.ts'
import type { OwnedColor } from '../../filaments/useOwnedColors.ts'
import OwnedColorSelect from '../../filaments/components/OwnedColorSelect.tsx'
import { loadedFirst, type AmsTray } from '../amsTrays.ts'

export default function FilamentColorField({ object, colors, trays, onPatch, label = 'Colour' }: {
  object: Pick<SceneObject, 'color'>
  colors: readonly OwnedColor[]
  /** The loaded AMS trays: their colours are listed first and say where they sit. */
  trays: readonly AmsTray[] | null
  onPatch: (patch: Partial<SceneObject>) => void
  label?: string
}) {
  if (!colors.length) return null
  // Matched by hex, because that is all the object carries: a colour picked
  // here and the same colour picked from an AMS tray are the same value.
  const current = colors.find(
    color => color.hexes[0].toUpperCase() === (object.color ?? '').toUpperCase()) ?? null

  return (
    <OwnedColorSelect
      label={label}
      colors={loadedFirst(colors, trays)}
      value={current?.key ?? null}
      onChange={choice => onPatch({ color: choice?.hexes[0] })}
      note={color => {
        const tray = trays?.find(t => t.key === color.key)
        return tray ? `in ${tray.label}` : null
      }}
    />
  )
}
