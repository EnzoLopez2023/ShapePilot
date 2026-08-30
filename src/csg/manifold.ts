// Lazy manifold-3d loader. The WASM is ~1 MB, so nothing outside the 3D routes
// should pay for it: every caller goes through `loadManifold()`, and the module
// is only reached by a dynamic import from the evaluator.
import type { ManifoldToplevel } from 'manifold-3d'

let pending: Promise<ManifoldToplevel> | null = null

/**
 * Resolves the singleton toplevel. `setup()` must run exactly once per module
 * instance, which is why the promise -- not the result -- is what gets cached:
 * two concurrent callers during the first load must not both call setup.
 */
export function loadManifold(): Promise<ManifoldToplevel> {
  pending ??= (async () => {
    const { default: Module } = await import('manifold-3d')
    const wasm = await Module()
    wasm.setup()
    return wasm
  })()
  return pending
}
