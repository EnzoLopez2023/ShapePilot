// Scene objects -> evaluated meshes, one per top-level object.
//
// Evaluation is async (the CSG kernel is WASM and lazy-loaded) while rendering
// is not, so results land in state. The document's `revision` is the key: it is
// a counter bumped by every mutation, which is far cheaper than deep-comparing
// an object tree on each render.
import { useEffect, useRef, useState } from 'react'
import type { Mesh } from '../../geometry/mesh.ts'
import { evaluateNode } from '../../csg/evaluate.ts'
import { objectNode } from '../../csg/fromScene.ts'
import type { TextOutlines } from '../../geometry/sceneShapes.ts'
import type { DesignDocument, SceneObject } from '../../model/document.ts'

export interface EvaluatedObject {
  object: SceneObject
  mesh: Mesh
}

export interface SceneMeshes {
  parts: EvaluatedObject[]
  evaluating: boolean
  /** Per-object failure, keyed by id, so one bad solid does not blank the view. */
  failures: Map<string, string>
}

export function useSceneMeshes(doc: DesignDocument, textOutlines: TextOutlines): SceneMeshes {
  const [state, setState] = useState<SceneMeshes>(
    { parts: [], evaluating: false, failures: new Map() })
  const generation = useRef(0)

  useEffect(() => {
    const run = ++generation.current
    let cancelled = false
    setState(prev => ({ ...prev, evaluating: true }))

    void (async () => {
      const parts: EvaluatedObject[] = []
      const failures = new Map<string, string>()

      for (const object of doc.objects) {
        if (!object.visible) continue
        const node = objectNode(object, { textOutlines })
        if (!node) continue
        try {
          parts.push({ object, mesh: await evaluateNode(node) })
        } catch (cause) {
          // A single unbuildable solid is reported next to its object rather
          // than taking the whole viewport down.
          failures.set(object.id, cause instanceof Error ? cause.message : 'could not be built')
        }
        if (run !== generation.current) return
      }

      if (!cancelled && run === generation.current) {
        setState({ parts, evaluating: false, failures })
      }
    })()

    return () => { cancelled = true }
    // revision covers every edit; listing objects would deep-compare the tree.
  }, [doc.revision, doc.objects, textOutlines])

  return state
}
