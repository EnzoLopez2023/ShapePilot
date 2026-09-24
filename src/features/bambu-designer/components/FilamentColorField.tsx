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

export default function FilamentColorField({ object, colors, onPatch, label = 'Colour' }: {
  object: Pick<SceneObject, 'color'>
  colors: readonly OwnedColor[]
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
      colors={colors}
      value={current?.key ?? null}
      onChange={choice => onPatch({ color: choice?.hexes[0] })}
    />
  )
}
