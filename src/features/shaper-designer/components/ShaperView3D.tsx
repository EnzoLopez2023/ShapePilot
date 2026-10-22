// The design with the thickness it would have, for a better read on it than a
// flat outline gives. Lazy-loaded: three.js and the CSG kernel are heavy and the
// 2D canvas is the default view. Dragging moves a part in the plane only -- the
// Shaper cuts flat stock, so there is nothing to rotate or lift.
import { Alert, Box } from '@mui/material'
import { useMemo } from 'react'
import Viewport3D from '../../../components/viewport3d/Viewport3D.tsx'
import type { ViewportPart } from '../../../components/viewport3d/Viewport3D.tsx'
import type { TextOutlines } from '../../../geometry/sceneShapes.ts'
import type { DesignDocument } from '../../../model/document.ts'
import { useSceneMeshes } from '../../bambu-designer/useSceneMeshes.ts'

export interface ShaperView3DProps {
  doc: DesignDocument
  textOutlines: TextOutlines
  selection: Set<string>
  snapMm: number
  imperial: boolean
  fitToken: number
  onSelect: (id: string, additive: boolean) => void
  onMove: (id: string, dx: number, dy: number) => void
  onClearSelection: () => void
}

export default function ShaperView3D(props: ShaperView3DProps) {
  const { doc, textOutlines, selection, snapMm, imperial, fitToken, onSelect, onMove, onClearSelection } = props
  const { parts, failures } = useSceneMeshes(doc, textOutlines)

  const viewportParts = useMemo<ViewportPart[]>(
    () => parts.map(p => ({
      id: p.object.id, mesh: p.mesh, mode: p.object.mode, color: p.object.color,
      origin: p.object.transform.position,
    })),
    [parts],
  )

  return (
    <Box sx={{ position: 'absolute', inset: 0 }}>
      <Viewport3D
        parts={viewportParts}
        selection={selection}
        gizmo="translate"
        snapMm={snapMm}
        imperial={imperial}
        fitToken={fitToken}
        onSelect={(id, additive) => (id ? onSelect(id, additive) : onClearSelection())}
        onTransform={(id, change) => onMove(id, change.position[0], change.position[1])}
      />
      {failures.size > 0 && (
        <Alert severity="warning" variant="outlined" sx={{ position: 'absolute', left: 12, bottom: 12 }}>
          {failures.size} {failures.size === 1 ? 'object' : 'objects'} could not be built in 3D.
        </Alert>
      )}
    </Box>
  )
}
