import { zipSync, strToU8 } from 'fflate'
import type { Mesh } from '../geometry/mesh.ts'

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`

const f = (v: number): string => {
  const s = v.toFixed(4)
  return s.replace(/\.?0+$/, '') || '0'
}

const meshXml = (mesh: Mesh): string => {
  const { positions: p, indices: ix } = mesh
  const verts: string[] = []
  for (let i = 0; i < p.length; i += 3) {
    verts.push(`<vertex x="${f(p[i])}" y="${f(p[i + 1])}" z="${f(p[i + 2])}"/>`)
  }
  const tris: string[] = []
  for (let t = 0; t < ix.length; t += 3) {
    tris.push(`<triangle v1="${ix[t]}" v2="${ix[t + 1]}" v3="${ix[t + 2]}"/>`)
  }
  return `<mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh>`
}

const pack = (model: string): ArrayBuffer => {
  const zipped = zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    '3D/3dmodel.model': strToU8(model),
  }, { level: 6 })
  // Return a plain ArrayBuffer so it drops straight into a Blob.
  return zipped.buffer.slice(
    zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
}

/**
 * 3MF carries explicit millimetre units and plate placement, so Bambu Studio
 * imports it without the unit guess and repair prompt that STL invites.
 */
export function writeThreeMf(mesh: Mesh, name = 'Keycap tray'): ArrayBuffer {
  return writeThreeMfParts([{ mesh, name }], name)
}

/**
 * One 3MF holding several bodies, each its own `<object>`, all placed at the
 * shared origin. A two-filament tray ships as two parts -- the tray and its
 * nameplate text -- already aligned, so in the slicer you just pick the text
 * and assign it a second filament.
 */
export function writeThreeMfParts(
  parts: readonly { mesh: Mesh; name: string }[], title = 'Keycap tray',
): ArrayBuffer {
  const objects = parts.map((part, i) =>
    `<object id="${i + 1}" type="model" name="${part.name.replace(/[<&>"]/g, '')}">${meshXml(part.mesh)}</object>`)
  const items = parts.map((_, i) => `<item objectid="${i + 1}"/>`)
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${title.replace(/[<&>]/g, '')}</metadata>
<metadata name="Application">ShapePilot Keycap Tray Designer</metadata>
<resources>${objects.join('')}</resources>
<build>${items.join('')}</build>
</model>`
  return pack(model)
}
