// Lazy manifold-3d loader. The WASM is ~1 MB, so nothing outside the 3D routes
// should pay for it: every caller goes through `loadManifold()`, and the module
// is only reached by a dynamic import from the evaluator.
import type { ManifoldToplevel } from 'manifold-3d'
// The bundler has to be told about the .wasm explicitly. Manifold's glue code
// resolves it relative to the document URL, which under a SPA fallback returns
// index.html and fails with "expected magic word". `?url` makes Vite emit and
// fingerprint the asset and hands back its real address.
import wasmUrl from 'manifold-3d/manifold.wasm?url'

const runsOnNode = (): boolean => {
  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process
  return typeof proc?.versions?.node === 'string'
}

let pending: Promise<ManifoldToplevel> | null = null

/**
 * Resolves the singleton toplevel. `setup()` must run exactly once per module
 * instance, which is why the promise -- not the result -- is what gets cached:
 * two concurrent callers during the first load must not both call setup.
 *
 * A load that FAILS is forgotten, though. Caching the rejection meant one bad
 * fetch -- a deploy swapping the server mid-request, a dropped connection --
 * left every later build on the page failing until a reload, even a plain box.
 */
export function loadManifold(): Promise<ManifoldToplevel> {
  pending ??= (async () => {
    const { default: Module } = await import('manifold-3d')
    // The condition is about which loader manifold will use, not about the DOM.
    // Where `process` exists -- Node, and jsdom under Vitest -- its glue reads
    // the file from disk and resolves the package copy itself; handing it a URL
    // there produces an ENOENT. Only a real browser fetch needs steering.
    const wasm = await Module(runsOnNode() ? undefined : { locateFile: () => wasmUrl })
    wasm.setup()
    return wasm
  })()
  const attempt = pending
  attempt.catch(() => { if (pending === attempt) pending = null })
  return attempt
}
