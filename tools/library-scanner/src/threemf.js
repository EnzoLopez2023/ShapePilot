// 3MF reader tuned for Bambu Studio / OrcaSlicer project files.
//
// A 3MF is a ZIP. We only decompress what we need: 3D/*.model (metadata +
// meshes), Metadata/*.config (plates, slice results, printer/filament) and the
// PNG thumbnails. Embedded G-code (sliced .gcode.3mf) is never inflated.

import { unzipSync, strFromU8 } from 'fflate'
import { applyTransform, composeTransforms, concatMeshes } from './mesh.js'

const MAX_ENTRY_BYTES = 256 * 1024 * 1024
const WANTED = [
  /^3D\/.*\.model$/i,
  /^Metadata\/(?:model_settings|slice_info|project_settings)\.config$/i,
  /^Metadata\/(?:plate_\d+|thumbnail)\.png$/i,
  /^Auxiliaries\/\.thumbnails\/thumbnail_(?:3mf|small)\.png$/i,
]

export function readThreeMf(buffer, { mesh = true } = {}) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const names = []
  const entries = unzipSync(u8, {
    filter(file) {
      names.push(file.name)
      if (file.originalSize > MAX_ENTRY_BYTES) return false
      if (!mesh && /^3D\/Objects\//i.test(file.name)) return false
      return WANTED.some((re) => re.test(file.name))
    },
  })
  const text = (name) => (entries[name] ? strFromU8(entries[name]) : '')
  const rootName = names.find((n) => /^3D\/3dmodel\.model$/i.test(n)) ?? names.find((n) => /^3D\/.*\.model$/i.test(n))
  const rootXml = rootName ? text(rootName) : ''

  const metadata = readModelMetadata(rootXml)
  const settings = readModelSettings(text('Metadata/model_settings.config'))
  const slice = readSliceInfo(text('Metadata/slice_info.config'))
  const project = readProjectSettings(text('Metadata/project_settings.config'))
  const hasGcode = names.some((n) => /^Metadata\/plate_\d+\.gcode$/i.test(n))

  const plates = settings.plates.map((plate) => {
    const sliced = slice.plates.find((p) => p.index === plate.index)
    return {
      ...plate,
      thumbnail: entries[`Metadata/plate_${plate.index}.png`] ? `Metadata/plate_${plate.index}.png` : null,
      seconds: sliced?.seconds ?? null,
      grams: sliced?.grams ?? null,
      filaments: sliced?.filaments ?? [],
    }
  })

  const heroName = [
    'Auxiliaries/.thumbnails/thumbnail_3mf.png',
    'Metadata/plate_1.png',
    'Metadata/thumbnail.png',
  ].find((n) => entries[n]?.length)

  let tris = null
  if (mesh && rootName) {
    try {
      tris = readMeshes(rootName, (name) => (entries[name] ? strFromU8(entries[name]) : ''))
    } catch {
      tris = null
    }
  }

  const slicedPlates = slice.plates.filter((p) => p.seconds != null)
  return {
    metadata,
    application: metadata.Application ?? null,
    plates,
    objectNames: settings.objectNames,
    isSliced: hasGcode || slicedPlates.length > 0,
    seconds: slicedPlates.length ? slicedPlates.reduce((n, p) => n + p.seconds, 0) : null,
    grams: slicedPlates.length ? round2(slicedPlates.reduce((n, p) => n + (p.grams ?? 0), 0)) : null,
    printer: project.printer ?? slice.printerModelId ?? null,
    nozzle: project.nozzle,
    layerHeight: project.layerHeight,
    printProfile: project.printProfile ?? metadata.ProfileTitle ?? null,
    filaments: project.filaments,
    hero: heroName ? Buffer.from(entries[heroName]) : null,
    plateImages: plates.filter((p) => p.thumbnail).map((p) => ({ index: p.index, png: Buffer.from(entries[p.thumbnail]) })),
    tris,
  }
}

// ── XML helpers (regex based; these files are machine written and flat) ──

export function decodeEntities(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function attrs(source) {
  const out = {}
  const re = /([\w:]+)\s*=\s*"([^"]*)"/g
  let m
  while ((m = re.exec(source))) out[m[1]] = decodeEntities(m[2])
  return out
}

function metadataKeys(block) {
  const out = {}
  const re = /<metadata\b([^>]*?)\/?>/g
  let m
  while ((m = re.exec(block))) {
    const a = attrs(m[1])
    if (a.key != null && a.value != null) out[a.key] = a.value
  }
  return out
}

function readModelMetadata(xml) {
  const out = {}
  const re = /<metadata\s+name="([^"]+)"\s*>([\s\S]*?)<\/metadata>/g
  let m
  while ((m = re.exec(xml))) {
    const value = decodeEntities(m[2]).trim()
    if (value && value !== '[]') out[m[1]] = value
  }
  if (out.Description) out.Description = htmlToText(out.Description)
  return out
}

/** MakerWorld descriptions are HTML escaped twice; reduce to readable plain text. */
export function htmlToText(value) {
  let text = value
  for (let i = 0; i < 2 && /&(?:lt|gt|amp|#\d+);/.test(text); i += 1) text = decodeEntities(text)
  return text
    .replace(/<(?:br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000)
}

function readModelSettings(xml) {
  const objectNames = []
  const objectsById = new Map()
  const objRe = /<object\s+id="(\d+)"\s*>([\s\S]*?)<\/object>/g
  let m
  while ((m = objRe.exec(xml))) {
    // The object's own name is the first <metadata key="name"> before any <part>.
    const own = m[2].split('<part')[0]
    const name = metadataKeys(own).name
    if (name) {
      objectsById.set(m[1], name)
      objectNames.push(name)
    }
  }
  const plates = []
  const plateRe = /<plate>([\s\S]*?)<\/plate>/g
  while ((m = plateRe.exec(xml))) {
    const head = m[1].split('<model_instance')[0]
    const meta = metadataKeys(head)
    const index = Number(meta.plater_id ?? plates.length + 1)
    const objects = []
    const instRe = /<model_instance>([\s\S]*?)<\/model_instance>/g
    let inst
    while ((inst = instRe.exec(m[1]))) {
      const id = metadataKeys(inst[1]).object_id
      const name = objectsById.get(id)
      if (name && !objects.includes(name)) objects.push(name)
    }
    plates.push({ index, name: meta.plater_name || null, objects })
  }
  return { plates, objectNames }
}

function readSliceInfo(xml) {
  const plates = []
  let printerModelId = null
  const plateRe = /<plate>([\s\S]*?)<\/plate>/g
  let m
  while ((m = plateRe.exec(xml))) {
    const meta = metadataKeys(m[1])
    printerModelId ??= meta.printer_model_id ?? null
    const filaments = []
    const filRe = /<filament\b([^>]*?)\/>/g
    let f
    while ((f = filRe.exec(m[1]))) {
      const a = attrs(f[1])
      filaments.push({ type: a.type ?? null, color: a.color ?? null, grams: num(a.used_g), meters: num(a.used_m) })
    }
    plates.push({ index: Number(meta.index ?? plates.length + 1), seconds: num(meta.prediction), grams: num(meta.weight), filaments })
  }
  return { plates, printerModelId }
}

function readProjectSettings(text) {
  const empty = { printer: null, nozzle: null, layerHeight: null, printProfile: null, filaments: [] }
  if (!text.trim().startsWith('{')) return empty
  let json
  try {
    json = JSON.parse(text)
  } catch {
    return empty
  }
  const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])
  const types = list(json.filament_type)
  const colors = list(json.filament_colour)
  const profiles = list(json.filament_settings_id)
  return {
    printer: json.printer_model || json.printer_settings_id || null,
    nozzle: num(list(json.nozzle_diameter)[0]),
    layerHeight: num(json.layer_height),
    printProfile: json.print_settings_id || null,
    filaments: types.map((type, i) => ({ type, color: colors[i] ?? null, profile: profiles[i] ?? null })),
  }
}

// ── Mesh assembly ──

function readMeshes(rootName, read) {
  const cache = new Map()
  const load = (path) => {
    if (!cache.has(path)) cache.set(path, parseObjects(read(path)))
    return cache.get(path)
  }
  const resolve = (path, id, transform, depth) => {
    if (depth > 8) return []
    const obj = load(path).get(id)
    if (!obj) return []
    const out = []
    if (obj.mesh) out.push(applyTransform(obj.mesh.slice(), transform))
    for (const c of obj.components) {
      const childPath = c.path ? c.path.replace(/^\//, '') : path
      out.push(...resolve(childPath, c.objectid, composeTransforms(transform, c.transform), depth + 1))
    }
    return out
  }
  const rootXml = read(rootName)
  const items = []
  const buildBlock = rootXml.match(/<build\b[^>]*>([\s\S]*?)<\/build>/)?.[1] ?? ''
  const itemRe = /<item\b([^>]*?)\/?>/g
  let m
  while ((m = itemRe.exec(buildBlock))) items.push(attrs(m[1]))
  const parts = []
  if (items.length) {
    for (const item of items) parts.push(...resolve(rootName, item.objectid, item.transform ?? null, 0))
  } else {
    for (const id of load(rootName).keys()) parts.push(...resolve(rootName, id, null, 0))
  }
  return parts.length ? concatMeshes(parts) : null
}

function parseObjects(xml) {
  const objects = new Map()
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g
  let m
  while ((m = objRe.exec(xml))) {
    const id = attrs(m[1]).id
    const body = m[2]
    const components = []
    const compRe = /<component\b([^>]*?)\/?>/g
    let c
    while ((c = compRe.exec(body))) {
      const a = attrs(c[1])
      components.push({ objectid: a.objectid, path: a['p:path'] ?? a.path ?? null, transform: a.transform ?? null })
    }
    objects.set(id, { mesh: body.includes('<mesh') ? parseMesh(body) : null, components })
  }
  return objects
}

function parseMesh(body) {
  const verts = []
  const vRe = /<vertex\b[^>]*?\bx="([^"]+)"[^>]*?\by="([^"]+)"[^>]*?\bz="([^"]+)"/g
  let m
  while ((m = vRe.exec(body))) verts.push(+m[1], +m[2], +m[3])
  const tris = []
  const tRe = /<triangle\b[^>]*?\bv1="(\d+)"[^>]*?\bv2="(\d+)"[^>]*?\bv3="(\d+)"/g
  while ((m = tRe.exec(body))) {
    for (const idx of [m[1], m[2], m[3]]) {
      const o = Number(idx) * 3
      tris.push(verts[o], verts[o + 1], verts[o + 2])
    }
  }
  return Float32Array.from(tris)
}

function num(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function round2(v) {
  return Math.round(v * 100) / 100
}
