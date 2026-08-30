// Resolving an imported object's triangles.
//
// Three places the bytes might be, tried in that order:
//
//   1. The parsed-mesh cache, so panning a scene does not re-parse a 60 MB STL.
//   2. IndexedDB, which is instant and works offline on the machine that
//      imported the file.
//   3. The server, which is what makes an import survive moving to another
//      device.
//
// If none of them has it the object reports as detached and the document still
// opens. That is the deliberate contract: assets are not authoritative, they are
// outside the backup manifest, and losing one must never break a design.
import type { Mesh } from '../geometry/mesh.ts'
import type { ImportFormat, SceneObject } from '../model/document.ts'
import { walk } from '../model/scene.ts'
import * as api from '../services/designAssets.ts'
import { assetStoreAvailable, getAsset, putAsset } from './assetStore.ts'
import { importObj, importStl, importThreeMf } from './mesh.ts'

/** Parsed meshes, keyed by content hash. A hash names immutable bytes, so an
 *  entry can never go stale. */
const parsed = new Map<string, Mesh>()

/**
 * Uploads in flight or already done, keyed by content hash.
 *
 * Without this, the opportunistic upload below fires on every resolve, and a
 * scene resolves on every evaluation -- several times over during a single
 * render pass. Re-sending the same bytes is merely wasteful at 600 bytes and
 * unacceptable at 60 MB. The promise is cached, not just a flag, so concurrent
 * resolves share one request; a failure drops the entry so a later attempt can
 * retry.
 */
const uploads = new Map<string, Promise<unknown>>()

function ensureUploaded(
  hash: string, bytes: ArrayBuffer, filename: string, format: ImportFormat,
): Promise<unknown> {
  let pending = uploads.get(hash)
  if (!pending) {
    pending = api.uploadAsset(hash, bytes, filename, format)
      .catch(cause => { uploads.delete(hash); throw cause })
    uploads.set(hash, pending)
  }
  return pending
}

async function parse(bytes: ArrayBuffer, format: ImportFormat): Promise<Mesh> {
  switch (format) {
    case 'stl': return (await importStl(bytes)).mesh
    case '3mf': return (await importThreeMf(bytes)).mesh
    case 'obj': return (await importObj(new TextDecoder().decode(bytes))).mesh
    // SVG and DXF become path objects at import time and carry their rings in
    // the document, so they never take this route.
    default: throw new Error(`${format} has no mesh form`)
  }
}

export interface ResolvedAssets {
  /** By content hash, ready to hand to the evaluator. */
  meshes: Map<string, Mesh>
  /** Object ids whose bytes could not be found anywhere. */
  detached: Set<string>
}

/**
 * Resolve every imported object in a scene. Uploads anything found locally but
 * missing from the server, so a file imported before this existed -- or while
 * offline -- becomes available on other devices the next time the scene loads.
 */
export async function resolveAssets(objects: readonly SceneObject[]): Promise<ResolvedAssets> {
  const meshes = new Map<string, Mesh>()
  const detached = new Set<string>()

  const imported = [...walk(objects)].filter(o => o.type === 'imported')
  if (!imported.length) return { meshes, detached }

  for (const object of imported) {
    if (object.type !== 'imported') continue
    const { hash, filename } = object.asset
    if (meshes.has(hash)) continue

    const cached = parsed.get(hash)
    if (cached) {
      meshes.set(hash, cached)
      continue
    }

    try {
      const bytes = await load(hash, filename, object.format)
      if (!bytes) {
        detached.add(object.id)
        continue
      }
      const mesh = await parse(bytes, object.format)
      parsed.set(hash, mesh)
      meshes.set(hash, mesh)
    } catch {
      // A file that will not parse is as unusable as one that is absent, and
      // the object reports the same way rather than taking the scene down.
      detached.add(object.id)
    }
  }

  return { meshes, detached }
}

async function load(
  hash: string, filename: string, format: ImportFormat,
): Promise<ArrayBuffer | null> {
  if (assetStoreAvailable()) {
    const local = await getAsset(hash).catch(() => undefined)
    if (local) {
      // Present locally but perhaps never uploaded -- an import made before
      // this device had a server to talk to. Best-effort and deduped, and never
      // allowed to fail the read.
      void ensureUploaded(hash, local.bytes, filename, format).catch(() => {})
      return local.bytes
    }
  }

  const remote = await api.fetchAsset(hash).catch(() => null)
  if (!remote) return null
  // It came from the server, so it is already there; record that so the
  // opportunistic upload never re-sends it.
  uploads.set(hash, Promise.resolve())

  // Cache it locally so the next open is instant and works offline.
  if (assetStoreAvailable()) {
    void putAsset(remote, filename, format).catch(() => {})
  }
  return remote
}

/** Store a freshly imported file in both places. The local write is what the
 *  current session reads; the upload is what other devices read. */
export async function storeImportedFile(
  bytes: ArrayBuffer, filename: string, format: ImportFormat,
): Promise<{ hash: string; filename: string; byteLength: number }> {
  const ref = await putAsset(bytes, filename, format)
  // Deliberately awaited: an import that silently failed to upload would look
  // fine until the user opened the design somewhere else.
  await ensureUploaded(ref.hash, bytes, filename, format)
  return ref
}
