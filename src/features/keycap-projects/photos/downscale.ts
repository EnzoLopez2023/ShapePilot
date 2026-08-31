// Preparing a photograph for upload.
//
// A phone photo of a keycap tray is 3-5 MB and 4032 px wide. Neither the
// artifact store nor the model needs that: the assistant reads legends and
// relative widths, both of which survive a long edge of 1600 px comfortably,
// and the browser only ever shows the picture in a thumbnail strip.
//
// This is the one place that decides image encoding. Everything downstream --
// the hash, the upload, the data URL the server builds -- follows from what
// comes out of here.
import type { ImageFormat } from '../../../services/designAssets.ts'

/** Long edge, in pixels. Legends stay readable well below this. */
const MAX_EDGE = 1600

/** JPEG, in the 0-1 range canvas.toBlob uses. */
const QUALITY = 0.85

/** What the file picker offers, and what a paste is checked against. */
export const PHOTO_ACCEPT = 'image/png,image/jpeg,image/webp,image/heic,image/heif'

/**
 * The browser refuses a file this large before the server has to. It is far
 * above any real photograph and exists only so a mis-picked video fails fast.
 */
export const MAX_PHOTO_BYTES = 32 * 1024 * 1024

export interface PreparedPhoto {
  bytes: ArrayBuffer
  format: ImageFormat
  filename: string
  width: number
  height: number
}

const isImage = (file: File): boolean => file.type.startsWith('image/')

/**
 * Decode, scale down if needed, and re-encode as JPEG.
 *
 * Always re-encoded, even when the image is already small: a HEIC off an iPhone
 * and a PNG screenshot both have to come out the far side as something the
 * model's `input_image` accepts, and branching on the input format would leave
 * the rare case untested. The decode is the browser's, so anything it can show
 * in an <img> can be uploaded.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!isImage(file)) throw new Error('that file is not an image')
  if (file.size > MAX_PHOTO_BYTES) throw new Error('that image is too large')

  const bitmap = await decode(file)
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('this browser cannot process images')
    // A photograph has no transparency to lose, and JPEG over a white ground
    // avoids a black rectangle where an alpha channel used to be.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY))
    if (!blob) throw new Error('this browser cannot process images')

    return {
      bytes: await blob.arrayBuffer(),
      format: 'jpeg',
      filename: jpegName(file.name),
      width,
      height,
    }
  } finally {
    bitmap.close()
  }
}

/** `createImageBitmap` is the only decoder here; jsdom has neither, so the
 *  tests that exercise the panel stub the upload rather than the canvas. */
const decode = (file: File): Promise<ImageBitmap> => createImageBitmap(file)

/** The stored name should describe the bytes that were stored, not the ones
 *  that were picked -- a `.heic` holding JPEG bytes is a small lie that shows
 *  up much later, in a download. */
function jpegName(original: string): string {
  const stem = original.replace(/\.[^./\\]+$/, '') || 'photo'
  return `${stem.slice(0, 80)}.jpg`
}
