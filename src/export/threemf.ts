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

/**
 * 3MF carries explicit millimetre units and plate placement, so Bambu Studio
 * imports it without the unit guess and repair prompt that STL invites.
 */
export function writeThreeMf(mesh: Mesh, name = 'Keycap tray'): ArrayBuffer {
  const { positions: p, indices: ix } = mesh
  const verts: string[] = []
  for (let i = 0; i < p.length; i += 3) {
    verts.push(`<vertex x="${f(p[i])}" y="${f(p[i + 1])}" z="${f(p[i + 2])}"/>`)
  }
  const tris: string[] = []
  for (let t = 0; t < ix.length; t += 3) {
    tris.push(`<triangle v1="${ix[t]}" v2="${ix[t + 1]}" v3="${ix[t + 2]}"/>`)
  }
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${name.replace(/[<&>]/g, '')}</metadata>
<metadata name="Application">ShapePilot Keycap Tray Designer</metadata>
<resources>
<object id="1" type="model">
<mesh>
<vertices>${verts.join('')}</vertices>
<triangles>${tris.join('')}</triangles>
</mesh>
</object>
</resources>
<build><item objectid="1"/></build>
</model>`

  const zipped = zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    '3D/3dmodel.model': strToU8(model),
  }, { level: 6 })
  // Return a plain ArrayBuffer so it drops straight into a Blob.
  return zipped.buffer.slice(
    zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
}
