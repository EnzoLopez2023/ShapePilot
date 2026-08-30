// Content-addressed storage for imported files, in the browser.
//
// PRODUCT.md keeps fabrication data off the server -- it stores parameters, not
// geometry -- so an imported STL cannot ride along in doc_json. The bytes live
// here, keyed by SHA-256, and the document carries only the hash. Reopening on
// the same browser resolves; on another device the object reports as detached
// and the file can be re-attached.
import type { AssetRef, ImportFormat } from '../model/document.ts'

const DB_NAME = 'shapepilot-assets'
const DB_VERSION = 1
const STORE = 'files'

export interface StoredAsset {
  hash: string
  filename: string
  format: ImportFormat
  bytes: ArrayBuffer
  storedAt: string
}

export async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'hash' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('could not open the asset store'))
  })
  return dbPromise
}

const run = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = fn(tx.objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('asset store request failed'))
  })
}

/**
 * Storing the same file twice is a no-op by construction -- the hash is the key.
 * Two documents referencing one imported part therefore share one copy.
 */
export async function putAsset(
  bytes: ArrayBuffer, filename: string, format: ImportFormat,
): Promise<AssetRef> {
  const hash = await hashBytes(bytes)
  const asset: StoredAsset = { hash, filename, format, bytes, storedAt: new Date().toISOString() }
  await run('readwrite', store => store.put(asset))
  return { hash, filename, byteLength: bytes.byteLength }
}

export const getAsset = (hash: string): Promise<StoredAsset | undefined> =>
  run('readonly', store => store.get(hash) as IDBRequest<StoredAsset | undefined>)

export const hasAsset = async (hash: string): Promise<boolean> =>
  (await run('readonly', store => store.count(hash))) > 0

export const deleteAsset = (hash: string): Promise<undefined> =>
  run('readwrite', store => store.delete(hash))

export const listAssets = (): Promise<string[]> =>
  run('readonly', store => store.getAllKeys() as IDBRequest<string[]>)
    .then(keys => keys.map(String))

/** Availability differs per browser profile, so callers must handle `false`
 *  rather than assume the store is there. */
export const assetStoreAvailable = (): boolean => typeof indexedDB !== 'undefined'
