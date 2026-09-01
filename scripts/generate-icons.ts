import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import {
  FAVICON_ASSET,
  ICON_MASTER,
  MASKABLE_ICON_ASSET,
  PNG_ICON_ASSETS,
  PWA_ICONS,
  PWA_INCLUDE_ASSETS,
} from './icon-assets.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDirectory = resolve(root, 'public')
const checkOnly = process.argv.slice(2).includes('--check')
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== '--check')

if (unknownArguments.length > 0) {
  throw new Error(`Unknown icon generation argument: ${unknownArguments.join(', ')}`)
}

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function assertOpaquePng(buffer: Buffer, expectedSize: number, label: string) {
  const metadata = await sharp(buffer).metadata()
  if (metadata.format !== 'png' || metadata.width !== expectedSize || metadata.height !== expectedSize) {
    throw new Error(
      `${label} must be an opaque ${expectedSize}x${expectedSize} PNG; found ` +
        `${metadata.format ?? 'unknown'} ${metadata.width ?? '?'}x${metadata.height ?? '?'}`,
    )
  }

  if (!metadata.hasAlpha) {
    return
  }

  const stats = await sharp(buffer).stats()
  if (stats.channels.length !== 4 || stats.channels[3].min !== 255) {
    throw new Error(`${label} contains transparent pixels`)
  }
}

function png(buffer: Buffer, size: number) {
  return sharp(buffer)
    .resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .ensureAlpha(1)
    .png({
      adaptiveFiltering: false,
      compressionLevel: 9,
      palette: false,
    })
    .toBuffer()
}

function createIco(entries: ReadonlyArray<{ size: number; buffer: Buffer }>) {
  const headerSize = 6 + entries.length * 16
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)

  let offset = headerSize
  entries.forEach(({ size, buffer }, index) => {
    const entryOffset = 6 + index * 16
    header.writeUInt8(size === 256 ? 0 : size, entryOffset)
    header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1)
    header.writeUInt8(0, entryOffset + 2)
    header.writeUInt8(0, entryOffset + 3)
    header.writeUInt16LE(1, entryOffset + 4)
    header.writeUInt16LE(32, entryOffset + 6)
    header.writeUInt32LE(buffer.length, entryOffset + 8)
    header.writeUInt32LE(offset, entryOffset + 12)
    offset += buffer.length
  })

  return Buffer.concat([header, ...entries.map(({ buffer }) => buffer)])
}

function readIcoEntries(buffer: Buffer) {
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    throw new Error(`${FAVICON_ASSET.fileName} has an invalid ICO header`)
  }

  const count = buffer.readUInt16LE(4)
  return Array.from({ length: count }, (_, index) => {
    const entryOffset = 6 + index * 16
    const width = buffer.readUInt8(entryOffset) || 256
    const height = buffer.readUInt8(entryOffset + 1) || 256
    const length = buffer.readUInt32LE(entryOffset + 8)
    const offset = buffer.readUInt32LE(entryOffset + 12)
    return { width, height, buffer: buffer.subarray(offset, offset + length) }
  })
}

function assertManifestContract() {
  const expectedIncludeAssets = new Set([
    FAVICON_ASSET.fileName,
    PNG_ICON_ASSETS[0].fileName,
  ])
  if (
    PWA_INCLUDE_ASSETS.length !== expectedIncludeAssets.size ||
    !PWA_INCLUDE_ASSETS.every((fileName) => expectedIncludeAssets.has(fileName))
  ) {
    throw new Error('The VitePWA includeAssets references do not match the generated browser icons')
  }

  const standardPwaFiles = new Set(PNG_ICON_ASSETS.slice(1).map(({ fileName }) => fileName))
  const manifestFiles = new Set(PWA_ICONS.map(({ src }) => src.slice(1)))
  for (const fileName of standardPwaFiles) {
    if (!manifestFiles.has(fileName)) {
      throw new Error(`The VitePWA manifest does not reference ${fileName}`)
    }
  }
  if (!manifestFiles.has(MASKABLE_ICON_ASSET.fileName)) {
    throw new Error(`The VitePWA manifest does not reference ${MASKABLE_ICON_ASSET.fileName}`)
  }

  for (const icon of PWA_ICONS) {
    const fileName = icon.src.slice(1)
    const expectedPurpose = fileName === MASKABLE_ICON_ASSET.fileName ? 'maskable' : 'any'
    if (icon.purpose !== expectedPurpose) {
      throw new Error(`${fileName} must have manifest purpose "${expectedPurpose}"`)
    }
  }

  const sourceHalfDiagonal =
    (MASKABLE_ICON_ASSET.size * MASKABLE_ICON_ASSET.sourceRatio * Math.SQRT2) / 2
  const safeZoneRadius = MASKABLE_ICON_ASSET.size * 0.4
  if (sourceHalfDiagonal > safeZoneRadius) {
    throw new Error('The maskable icon source extends beyond the standard 80% safe-zone circle')
  }
}

async function createMaskableIcon(master: Buffer) {
  const sourceSize = Math.floor(MASKABLE_ICON_ASSET.size * MASKABLE_ICON_ASSET.sourceRatio)
  const source = await png(master, sourceSize)
  const { data: corner } = await sharp(master)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const offset = Math.floor((MASKABLE_ICON_ASSET.size - sourceSize) / 2)

  return sharp({
    create: {
      width: MASKABLE_ICON_ASSET.size,
      height: MASKABLE_ICON_ASSET.size,
      channels: 4,
      background: { r: corner[0], g: corner[1], b: corner[2], alpha: 1 },
    },
  })
    .composite([{ input: source, left: offset, top: offset }])
    .png({
      adaptiveFiltering: false,
      compressionLevel: 9,
      palette: false,
    })
    .toBuffer()
}

async function createExpectedAssets(master: Buffer) {
  const pngAssets = await Promise.all(
    PNG_ICON_ASSETS.map(async (asset) => [asset.fileName, await png(master, asset.size)] as const),
  )
  const faviconEntries = await Promise.all(
    FAVICON_ASSET.sizes.map(async (size) => ({ size, buffer: await png(master, size) })),
  )
  const maskableIcon = await createMaskableIcon(master)

  return new Map<string, Buffer>([
    ...pngAssets,
    [FAVICON_ASSET.fileName, createIco(faviconEntries)],
    [MASKABLE_ICON_ASSET.fileName, maskableIcon],
  ])
}

function assertPinnedDerivativeHashes(expectedAssets: ReadonlyMap<string, Buffer>) {
  const pinnedHashes = new Map<string, string>([
    ...PNG_ICON_ASSETS.map(({ fileName, sha256: hash }) => [fileName, hash] as const),
    [FAVICON_ASSET.fileName, FAVICON_ASSET.sha256],
    [MASKABLE_ICON_ASSET.fileName, MASKABLE_ICON_ASSET.sha256],
  ])

  for (const [fileName, expectedHash] of pinnedHashes) {
    const buffer = expectedAssets.get(fileName)
    if (!buffer) {
      throw new Error(`Icon generation omitted ${fileName}`)
    }
    const generatedHash = sha256(buffer)
    if (generatedHash !== expectedHash) {
      throw new Error(
        `${fileName} generation is not deterministic: expected ${expectedHash}, found ${generatedHash}`,
      )
    }
  }
}

async function verifyAssets(master: Buffer, expectedAssets: ReadonlyMap<string, Buffer>) {
  await assertOpaquePng(master, ICON_MASTER.size, ICON_MASTER.fileName)

  for (const asset of PNG_ICON_ASSETS) {
    const actual = await readFile(resolve(publicDirectory, asset.fileName))
    const expected = expectedAssets.get(asset.fileName)
    if (!expected || !actual.equals(expected)) {
      throw new Error(`${asset.fileName} has drifted; run npm run icons:generate`)
    }
    await assertOpaquePng(actual, asset.size, asset.fileName)
  }

  const maskable = await readFile(resolve(publicDirectory, MASKABLE_ICON_ASSET.fileName))
  const expectedMaskable = expectedAssets.get(MASKABLE_ICON_ASSET.fileName)
  if (!expectedMaskable || !maskable.equals(expectedMaskable)) {
    throw new Error(`${MASKABLE_ICON_ASSET.fileName} has drifted; run npm run icons:generate`)
  }
  await assertOpaquePng(maskable, MASKABLE_ICON_ASSET.size, MASKABLE_ICON_ASSET.fileName)

  const favicon = await readFile(resolve(publicDirectory, FAVICON_ASSET.fileName))
  const expectedFavicon = expectedAssets.get(FAVICON_ASSET.fileName)
  if (!expectedFavicon || !favicon.equals(expectedFavicon)) {
    throw new Error(`${FAVICON_ASSET.fileName} has drifted; run npm run icons:generate`)
  }
  const entries = readIcoEntries(favicon)
  if (
    entries.length !== FAVICON_ASSET.sizes.length ||
    !entries.every(
      ({ width, height }, index) =>
        width === FAVICON_ASSET.sizes[index] && height === FAVICON_ASSET.sizes[index],
    )
  ) {
    throw new Error(`${FAVICON_ASSET.fileName} does not contain the expected icon dimensions`)
  }
  await Promise.all(
    entries.map(({ width, buffer }) =>
      assertOpaquePng(buffer, width, `${FAVICON_ASSET.fileName} ${width}x${width}`),
    ),
  )
}

assertManifestContract()

const master = await readFile(resolve(publicDirectory, ICON_MASTER.fileName))
const masterHash = sha256(master)
if (masterHash !== ICON_MASTER.sha256) {
  throw new Error(
    `${ICON_MASTER.fileName} SHA-256 mismatch: expected ${ICON_MASTER.sha256}, found ${masterHash}`,
  )
}

const expectedAssets = await createExpectedAssets(master)
assertPinnedDerivativeHashes(expectedAssets)
if (!checkOnly) {
  await Promise.all(
    [...expectedAssets].map(([fileName, buffer]) =>
      writeFile(resolve(publicDirectory, fileName), buffer),
    ),
  )
}

await verifyAssets(master, expectedAssets)
console.log(checkOnly ? 'Icon assets are canonical.' : 'Generated canonical icon assets.')
