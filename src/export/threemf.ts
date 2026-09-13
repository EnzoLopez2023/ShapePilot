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

/** Bambu Studio stores a part's own transform here; ours are already baked into
 *  the vertices, so every part carries the identity. Row-major 4x4. */
const IDENTITY = '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1'

const f = (v: number): string => {
  const s = v.toFixed(4)
  return s.replace(/\.?0+$/, '') || '0'
}

const ENTITIES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
}

const esc = (s: string): string => s.replace(/[&<>"]/g, c => ENTITIES[c])

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

const modelXml = (objects: readonly string[], items: readonly string[], title: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${esc(title)}</metadata>
<metadata name="Application">ShapePilot Keycap Tray Designer</metadata>
<resources>${objects.join('')}</resources>
<build>${items.join('')}</build>
</model>`

/**
 * `Metadata/model_settings.config` is Bambu's own sidecar, and the only thing
 * that makes a multi-body 3MF useful: without it the slicer has no part names
 * and no per-part filament, so an imported model is one uncolourable lump.
 *
 * Part ids match the component `objectid`s, and the components are emitted in
 * the same order, so the two ways a reader might pair them up agree.
 */
const modelSettingsXml = (
  parts: readonly ThreeMfPart[], title: string, groupId: number,
): string => `<?xml version="1.0" encoding="UTF-8"?>
<config>
<object id="${groupId}">
<metadata key="name" value="${esc(title)}"/>
<metadata key="extruder" value="${parts[0].extruder ?? 1}"/>
${parts.map((part, i) => `<part id="${i + 1}" subtype="normal_part">
<metadata key="name" value="${esc(part.name)}"/>
<metadata key="matrix" value="${IDENTITY}"/>
<metadata key="extruder" value="${part.extruder ?? 1}"/>
</part>`).join('\n')}
</object>
<plate>
<metadata key="plater_id" value="1"/>
<metadata key="plater_name" value=""/>
<metadata key="locked" value="false"/>
<model_instance>
<metadata key="object_id" value="${groupId}"/>
<metadata key="instance_id" value="0"/>
</model_instance>
</plate>
</config>`

const pack = (model: string, settings?: string): ArrayBuffer => {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    '3D/3dmodel.model': strToU8(model),
  }
  if (settings) files['Metadata/model_settings.config'] = strToU8(settings)
  const zipped = zipSync(files, { level: 6 })
  // Return a plain ArrayBuffer so it drops straight into a Blob.
  return zipped.buffer.slice(
    zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
}

export interface ThreeMfPart {
  mesh: Mesh
  name: string
  /** 1-based filament slot. Defaults to 1, the same as leaving it unset in the
   *  slicer; callers that mean a part to print in an accent colour say so. */
  extruder?: number
}

/**
 * 3MF carries explicit millimetre units and plate placement, so Bambu Studio
 * imports it without the unit guess and repair prompt that STL invites.
 */
export function writeThreeMf(mesh: Mesh, name = 'Keycap tray'): ArrayBuffer {
  return writeThreeMfParts([{ mesh, name }], name)
}

/**
 * One 3MF holding several bodies. They ship as components of a single object,
 * which is what lets the slicer treat them as *parts*: they stay locked in
 * their designed alignment, move as a unit, and take a filament each.
 *
 * Emitting them as separate top-level objects instead -- which is what this
 * used to do -- leaves them loose on the plate, free to drift apart. Merging
 * them into one mesh is worse still: a union destroys the boundary between the
 * bodies, and no amount of slicer coaxing gets it back.
 *
 * A lone part needs none of that machinery and keeps the flat single-object
 * shape, so the common single-body export is byte-for-byte what it always was.
 */
export function writeThreeMfParts(
  parts: readonly ThreeMfPart[], title = 'Keycap tray',
): ArrayBuffer {
  const objects = parts.map((part, i) =>
    `<object id="${i + 1}" type="model" name="${esc(part.name)}">${meshXml(part.mesh)}</object>`)

  if (parts.length < 2) {
    return pack(modelXml(objects, parts.map((_, i) => `<item objectid="${i + 1}"/>`), title))
  }

  const groupId = parts.length + 1
  const components = parts.map((_, i) => `<component objectid="${i + 1}"/>`).join('')
  objects.push(
    `<object id="${groupId}" type="model" name="${esc(title)}">`
    + `<components>${components}</components></object>`)

  return pack(
    modelXml(objects, [`<item objectid="${groupId}"/>`], title),
    modelSettingsXml(parts, title, groupId))
}
