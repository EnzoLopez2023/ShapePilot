// The mesh a pending AI proposal would leave behind, for the viewport to show
// before anything is applied.
//
// It is the merged scene, not the proposal's program on its own: an import or a
// hidden part the assistant could not touch is part of what Apply produces, so
// it is part of the picture.
import { useEffect, useRef, useState } from 'react'
import type { Mesh } from '../../geometry/mesh.ts'
import type { TextOutlines } from '../../geometry/sceneShapes.ts'
import type { SceneObject } from '../../model/document.ts'
import { evaluateProgram } from '../../csg/evaluate.ts'
import { programFromScene } from '../../csg/fromScene.ts'
import { mergeProposal } from '../../csg/mergeProposal.ts'
import { resolveAssets } from '../../import/assets.ts'
import type { Proposal } from './useAiDesigner.ts'

/** The id the preview part carries, so selection and transforms can ignore it. */
export const PREVIEW_PART_ID = '__preview'

export function useProposalPreview(
  proposal: Proposal | null,
  objects: readonly SceneObject[],
  textOutlines: TextOutlines,
): Mesh | null {
  const [mesh, setMesh] = useState<Mesh | null>(null)
  const token = useRef(0)
  useEffect(() => {
    const run = ++token.current
    if (!proposal) { setMesh(null); return }
    const merged = mergeProposal(objects, proposal.sent, proposal.program)
    void resolveAssets(merged)
      .then(({ meshes }) => evaluateProgram(programFromScene(merged, { textOutlines }), { meshes }))
      .then(result => { if (run === token.current) setMesh(result) })
      .catch(() => { if (run === token.current) setMesh(null) })
  }, [proposal, objects, textOutlines])
  return mesh
}
