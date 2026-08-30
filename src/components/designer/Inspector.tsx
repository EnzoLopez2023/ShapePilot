// The properties panel. One component for all three sub-apps: which fields
// appear follows from the selected object's type, and the CNC block appears
// only where a cut type means something.
import { Divider, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import type {
  CutType, ObjectMode, SceneObject, Shape2DObject, SolidObject, TextObject, Triple,
} from '../../model/document.ts'
import LengthField from '../LengthField.tsx'
import AngleField from '../AngleField.tsx'
import { EmptyState } from '../LoadingState.tsx'

export interface InspectorProps {
  object: SceneObject | null
  /** How many are selected; the panel only edits one at a time. */
  selectionCount: number
  imperial: boolean
  /** Shaper shows the cut block; the 3D designers do not. */
  showCut?: boolean
  /** 2D designers have no z axis to edit. */
  showZ?: boolean
  onPatch: (patch: Partial<SceneObject>) => void
}

const CUT_TYPES: { value: CutType; label: string; hint: string }[] = [
  { value: 'exterior', label: 'Exterior', hint: 'Cut around the outside, keeping the shape at size' },
  { value: 'interior', label: 'Interior', hint: 'Cut a through-hole at the shape’s dimensions' },
  { value: 'pocket', label: 'Pocket', hint: 'Clear the inside to a depth' },
  { value: 'online', label: 'On-line', hint: 'Centre the bit on the path, for engraving' },
  { value: 'guide', label: 'Guide', hint: 'A reference mark; Origin will not cut it' },
]

export default function Inspector(props: InspectorProps) {
  const { object, selectionCount, imperial, showCut = false, showZ = true, onPatch } = props

  if (selectionCount === 0) {
    return (
      <EmptyState
        title="Nothing selected"
        description="Select an object on the canvas to edit its dimensions."
      />
    )
  }
  if (selectionCount > 1 || !object) {
    return (
      <EmptyState
        title={`${selectionCount} objects selected`}
        description="Group them, or select one to edit its properties."
      />
    )
  }

  const t = object.transform
  const setTransform = (key: 'position' | 'rotationDeg' | 'scale', index: 0 | 1 | 2, value: number) => {
    const next = [...t[key]] as [number, number, number]
    next[index] = value
    onPatch({ transform: { ...t, [key]: next as Triple } })
  }

  const params = (object as Shape2DObject | SolidObject).params as Record<string, number | undefined> | undefined
  const setParam = (key: string, value: number) =>
    onPatch({ params: { ...params, [key]: value } } as Partial<SceneObject>)

  return (
    <Stack spacing={1.5}>
      <TextField
        label="Name"
        size="small"
        value={object.name}
        onChange={e => onPatch({ name: e.target.value })}
      />

      <ToggleButtonGroup
        size="small"
        exclusive
        value={object.mode}
        onChange={(_e, value: ObjectMode | null) => value && onPatch({ mode: value })}
        aria-label="Solid or hole"
        fullWidth
      >
        <ToggleButton value="solid" aria-label="Solid">Solid</ToggleButton>
        <ToggleButton value="hole" aria-label="Hole">Hole</ToggleButton>
      </ToggleButtonGroup>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: -1 }}>
        A hole removes material from the objects it is grouped with.
      </Typography>

      <Divider />
      <Typography variant="h3">Position</Typography>
      <Stack direction="row" spacing={1}>
        <LengthField
          label="X" valueMm={t.position[0]} imperial={imperial}
          onChangeMm={v => setTransform('position', 0, v)}
        />
        <LengthField
          label="Y" valueMm={t.position[1]} imperial={imperial}
          onChangeMm={v => setTransform('position', 1, v)}
        />
        {showZ && (
          <LengthField
            label="Z" valueMm={t.position[2]} imperial={imperial}
            onChangeMm={v => setTransform('position', 2, v)}
          />
        )}
      </Stack>

      <AngleField
        label={showZ ? 'Rotation about Z' : 'Rotation'}
        valueDeg={t.rotationDeg[2]}
        onChangeDeg={v => setTransform('rotationDeg', 2, v)}
      />

      {objectDimensions(object, imperial, setParam, onPatch)}

      {showCut && (
        <>
          <Divider />
          <Typography variant="h3">Cut</Typography>
          <TextField
            select size="small" label="Cut type"
            value={object.cut?.type ?? 'exterior'}
            onChange={e => onPatch({
              cut: { ...object.cut, type: e.target.value as CutType },
            })}
            helperText={CUT_TYPES.find(c => c.value === (object.cut?.type ?? 'exterior'))?.hint}
          >
            {CUT_TYPES.map(c => (
              <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
            ))}
          </TextField>
          {(object.cut?.type ?? 'exterior') === 'pocket' && (
            <LengthField
              label="Depth"
              valueMm={object.cut?.depthMm ?? 3}
              imperial={imperial}
              onChangeMm={v => onPatch({ cut: { type: 'pocket', depthMm: v } })}
            />
          )}
        </>
      )}
    </Stack>
  )
}

/** The dimension fields that make sense for this object's own type. */
function objectDimensions(
  object: SceneObject,
  imperial: boolean,
  setParam: (key: string, value: number) => void,
  onPatch: (patch: Partial<SceneObject>) => void,
) {
  const length = (label: string, key: string, fallback: number) => {
    const params = (object as Shape2DObject | SolidObject).params as Record<string, number | undefined>
    return (
      <LengthField
        key={key} label={label} imperial={imperial}
        valueMm={params?.[key] ?? fallback}
        onChangeMm={v => setParam(key, v)}
      />
    )
  }

  switch (object.type) {
    case 'shape2d': {
      const fields = {
        circle: [length('Radius', 'radiusMm', 10)],
        ellipse: [length('Radius X', 'radiusMm', 10), length('Radius Y', 'radiusYMm', 10)],
        rect: [length('Width', 'widthMm', 10), length('Height', 'heightMm', 10),
          length('Corner radius', 'cornerRadiusMm', 0)],
        square: [length('Side', 'widthMm', 10), length('Corner radius', 'cornerRadiusMm', 0)],
        triangle: [length('Width', 'widthMm', 10), length('Height', 'heightMm', 10)],
        polygon: [length('Radius', 'radiusMm', 10), sidesField(object, setParam)],
      }[object.shape]
      return (
        <>
          <Divider />
          <Typography variant="h3">Size</Typography>
          {fields}
        </>
      )
    }

    case 'solid': {
      const fields = {
        box: ['widthMm', 'depthMm', 'heightMm'],
        wedge: ['widthMm', 'depthMm', 'heightMm'],
        cylinder: ['radiusMm', 'heightMm'],
        sphere: ['radiusMm'],
        cone: ['radiusMm', 'topRadiusMm', 'heightMm'],
        torus: ['radiusMm', 'tubeMm'],
      }[object.primitive]
      const labels: Record<string, string> = {
        widthMm: 'Width', depthMm: 'Depth', heightMm: 'Height',
        radiusMm: 'Radius', topRadiusMm: 'Top radius', tubeMm: 'Tube radius',
      }
      return (
        <>
          <Divider />
          <Typography variant="h3">Size</Typography>
          {fields.map(key => length(labels[key], key, 10))}
        </>
      )
    }

    case 'text': {
      const text = object as TextObject
      return (
        <>
          <Divider />
          <Typography variant="h3">Text</Typography>
          <TextField
            label="Text" size="small" value={text.text}
            onChange={e => onPatch({ text: e.target.value, name: e.target.value.slice(0, 24) || 'Text' } as Partial<SceneObject>)}
          />
          <LengthField
            label="Size" valueMm={text.sizeMm} imperial={imperial}
            onChangeMm={v => onPatch({ sizeMm: v } as Partial<SceneObject>)}
          />
        </>
      )
    }

    case 'path':
    case 'imported':
    case 'group':
      // Imported outlines and groups have no parameters to edit; they are moved,
      // rotated and scaled as a whole, which the transform block above covers.
      return null
  }
}

function sidesField(
  object: SceneObject,
  setParam: (key: string, value: number) => void,
) {
  const params = (object as Shape2DObject).params as Record<string, number | undefined>
  return (
    <TextField
      key="sides"
      label="Sides"
      size="small"
      type="number"
      value={params?.sides ?? 6}
      slotProps={{ htmlInput: { min: 3, max: 64, step: 1 } }}
      onChange={e => {
        const n = Number(e.target.value)
        if (Number.isInteger(n) && n >= 3 && n <= 64) setParam('sides', n)
      }}
    />
  )
}
