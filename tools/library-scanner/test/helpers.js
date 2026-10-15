import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { DEFAULT_CONFIG } from '../src/config.js'

/** Unit cube as a triangle soup, optionally offset. */
export function cubeTris(size = 10, [ox, oy, oz] = [0, 0, 0]) {
  const v = (x, y, z) => [ox + x * size, oy + y * size, oz + z * size]
  const quads = [
    [v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)],
    [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)],
    [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)],
    [v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)],
    [v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)],
    [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)],
  ]
  const out = []
  for (const [a, b, c, d] of quads) out.push(...a, ...b, ...c, ...a, ...c, ...d)
  return Float32Array.from(out)
}

export function binaryStl(tris, header = 'test') {
  const n = tris.length / 9
  const buf = Buffer.alloc(84 + 50 * n)
  buf.write(header.slice(0, 79), 0, 'latin1')
  buf.writeUInt32LE(n, 80)
  for (let t = 0; t < n; t += 1) {
    for (let k = 0; k < 9; k += 1) buf.writeFloatLE(tris[t * 9 + k], 84 + t * 50 + 12 + k * 4)
  }
  return buf
}

export function asciiStl(tris, name = 'thing') {
  const lines = [`solid ${name}`]
  for (let i = 0; i < tris.length; i += 9) {
    lines.push(' facet normal 0 0 0', '  outer loop')
    for (let k = 0; k < 9; k += 3) lines.push(`   vertex ${tris[i + k]} ${tris[i + k + 1]} ${tris[i + k + 2]}`)
    lines.push('  endloop', ' endfacet')
  }
  lines.push(`endsolid ${name}`)
  return Buffer.from(lines.join('\n'))
}

/** A Bambu-style 3MF: root model with components pointing at an object file, plates and slice info. */
export function bambuThreeMf({ title = 'Test Model', designer = 'Maker', sliced = false, tris = cubeTris(), modelId = 'US123' } = {}) {
  const verts = []
  const faces = []
  for (let i = 0; i < tris.length; i += 3) verts.push(`<vertex x="${tris[i]}" y="${tris[i + 1]}" z="${tris[i + 2]}"/>`)
  for (let t = 0; t < tris.length / 9; t += 1) faces.push(`<triangle v1="${t * 3}" v2="${t * 3 + 1}" v3="${t * 3 + 2}"/>`)
  const files = {
    '3D/3dmodel.model': strToU8(`<?xml version="1.0"?>
<model unit="millimeter" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
 <metadata name="Application">BambuStudio-02.08.02.61</metadata>
 <metadata name="Title">${title}</metadata>
 <metadata name="Designer">${designer}</metadata>
 ${modelId ? `<metadata name="DesignModelId">${modelId}</metadata>` : ''}
 <metadata name="License">BY-NC</metadata>
 <metadata name="Description">&amp;lt;p&amp;gt;Nice &amp;amp;amp; useful&amp;lt;/p&amp;gt;</metadata>
 <resources><object id="2" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object></resources>
 <build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 100 100 5"/></build>
</model>`),
    '3D/Objects/object_1.model': strToU8(`<?xml version="1.0"?><model><resources><object id="1" type="model"><mesh><vertices>${verts.join('')}</vertices><triangles>${faces.join('')}</triangles></mesh></object></resources></model>`),
    'Metadata/model_settings.config': strToU8(`<config>
  <object id="2"><metadata key="name" value="cube.stl"/><part id="1"><metadata key="name" value="cube.stl"/></part></object>
  <plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value="Main"/><model_instance><metadata key="object_id" value="2"/></model_instance></plate>
</config>`),
    'Metadata/project_settings.config': strToU8(JSON.stringify({ printer_model: 'Bambu Lab X2D', nozzle_diameter: ['0.4'], layer_height: '0.2', filament_type: ['PLA'], filament_colour: ['#FF0000'] })),
    'Metadata/plate_1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
    'Metadata/slice_info.config': strToU8(
      sliced
        ? `<config><plate><metadata key="index" value="1"/><metadata key="prediction" value="3600"/><metadata key="weight" value="12.5"/><filament id="1" type="PLA" color="#FF0000" used_m="4" used_g="12.5"/></plate></config>`
        : '<config><header/></config>',
    ),
  }
  if (sliced) files['Metadata/plate_1.gcode'] = strToU8('G28\n')
  return Buffer.from(zipSync(files))
}

const OLD = new Date(Date.now() - 3600_000)

function put(path, data, { old = true } = {}) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
  if (old) utimesSync(path, OLD, OLD)
}

export function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'library-'))
  const lib = join(base, '3D Print')
  const dl = join(base, 'Downloads')
  const latch = binaryStl(cubeTris(12), 'latch')
  const foo = bambuThreeMf({ title: 'foo bar' })
  const kitPart = binaryStl(cubeTris(7), 'kit')

  put(join(lib, 'Review', 'foo+bar.3mf'), foo)
  put(join(lib, 'Review', 'foo+bar (2).3mf'), foo)
  put(join(lib, 'Printed', 'Systainer Latch.stl'), latch)
  put(join(lib, 'Festool', 'Sub Model', 'a.stl'), binaryStl(cubeTris(3), 'a'))
  put(join(lib, 'Festool', 'Sub Model', 'photo.jpg'), 'jpg')
  put(join(lib, 'Pictures for source generation', 'ref.stl'), binaryStl(cubeTris(4), 'ref'))
  put(join(lib, 'Reviewed', 'old.stl'), binaryStl(cubeTris(5), 'old'))
  put(join(lib, 'X2D stuff', 'ams thing.3mf'), bambuThreeMf({ title: 'AMS Riser', tris: cubeTris(9) }))
  put(join(lib, 'X2D stuff', 'P2S+_+Toolbox', 'Main parts', 'lid.stl'), binaryStl(cubeTris(11), 'lid'))
  put(join(lib, 'X2D stuff', 'P2S+_+Toolbox', 'Main parts', '.DS_Store'), 'x')
  put(join(lib, 'X2D stuff', 'P2S+_+Toolbox', 'Extras', 'hinge.stl'), binaryStl(cubeTris(13), 'hinge'))
  put(join(lib, 'settings.pdf'), 'pdf')

  put(join(dl, 'tray.stl'), binaryStl(cubeTris(6), 'H: Big Tray'))
  put(join(dl, 'new+thing.3mf'), bambuThreeMf({ title: 'Untitled', tris: cubeTris(8) }))
  put(join(dl, 'Kit.zip'), Buffer.from(zipSync({ 'Kit/a.stl': new Uint8Array(kitPart), 'Kit/readme.txt': strToU8('print flat'), '__MACOSX/._a.stl': strToU8('x') })))
  put(join(dl, 'Kit', 'a.stl'), kitPart)
  put(join(dl, 'Systainer Latch (1).stl'), latch)
  put(join(dl, 'Statements', 'march.pdf'), 'pdf')
  put(join(dl, 'Mixed', 'part.stl'), binaryStl(cubeTris(2), 'mixed'))
  put(join(dl, 'Mixed', 'setup.exe'), 'exe')
  put(join(dl, 'lab.zip'), Buffer.from(zipSync({ 'results.pdf': strToU8('pdf') })))
  put(join(dl, 'Recent.stl'), binaryStl(cubeTris(1), 'recent'), { old: false })

  const config = {
    ...DEFAULT_CONFIG,
    libraryRoot: lib,
    intakeRoots: [dl],
    indexOnlyRoots: [],
    cacheDir: join(base, 'cache'),
    trashDir: join(base, 'Trash'),
  }
  mkdirSync(config.trashDir)
  return { base, lib, dl, config }
}

