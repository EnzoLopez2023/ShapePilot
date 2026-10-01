// Every zip this app writes, written the same way twice.
//
// fflate stamps each entry with the wall clock unless you tell it otherwise, so
// exporting the same design twice produced different bytes. That is wrong in
// two places at once:
//
//   * models/ commits generated files so a printed set can be pinned to the
//     revision that made it -- "a change to the config shows up as a diff in
//     this directory, which is the point" (models/README.md). A 3MF that
//     changes on every build makes every regeneration look like a change and
//     hides the one that is real.
//   * A download the user re-exports to check against an earlier one should be
//     the same file, not a file that merely contains the same thing.
//
// So the timestamp is pinned. 1980-01-01 is the DOS epoch, the earliest a zip
// can encode, and it is built from LOCAL calendar fields on purpose: fflate
// reads `getFullYear()` and friends, so a UTC instant would encode as 1979 west
// of Greenwich and be rejected. Local midnight on that date is 1980 everywhere,
// which makes the bytes identical on this laptop and on CI.
import { zipSync } from 'fflate'
import type { Zippable } from 'fflate'

const DOS_EPOCH = new Date(1980, 0, 1, 0, 0, 0)

/**
 * A deflated zip with no clock in it. Use this instead of calling `zipSync`.
 * The return type is inferred rather than annotated: fflate hands back a
 * `Uint8Array` over a plain ArrayBuffer, and widening it to ArrayBufferLike
 * stops it being a `BlobPart`.
 */
export const zipParts = (files: Zippable) =>
  zipSync(files, { level: 6, mtime: DOS_EPOCH })

/** The same, handed back as a plain ArrayBuffer so it drops into a Blob. */
export function zipBuffer(files: Zippable): ArrayBuffer {
  const zipped = zipParts(files)
  return zipped.buffer.slice(
    zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
}
