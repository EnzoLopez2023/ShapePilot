// STL reader (binary and ASCII). Returns the triangle soup plus the binary
// header, which ShapePilot fills with "H: <design name>".

export function readStl(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  if (buf.length >= 84) {
    const count = buf.readUInt32LE(80)
    if (84 + count * 50 === buf.length) return readBinary(buf, count)
  }
  const head = buf.subarray(0, 512).toString('latin1').trimStart()
  if (head.startsWith('solid')) return readAscii(buf.toString('latin1'))
  throw new Error('Unrecognized STL (neither binary nor ASCII)')
}

function readBinary(buf, count) {
  const tris = new Float32Array(count * 9)
  let o = 84
  for (let t = 0; t < count; t += 1) {
    for (let k = 0; k < 9; k += 1) tris[t * 9 + k] = buf.readFloatLE(o + 12 + k * 4)
    o += 50
  }
  const header = buf.subarray(0, 80).toString('latin1').replace(/\0.*$/s, '').trim()
  return { tris, header, format: 'binary' }
}

function readAscii(text) {
  const values = []
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g
  let m
  while ((m = re.exec(text))) values.push(Number(m[1]), Number(m[2]), Number(m[3]))
  const usable = values.length - (values.length % 9)
  const name = text.match(/^\s*solid[ \t]*([^\r\n]*)/)?.[1]?.trim() ?? ''
  return { tris: Float32Array.from(values.slice(0, usable)), header: name, format: 'ascii' }
}

/** ShapePilot writes `H: <design name>`; returns that name or null. */
export function shapePilotName(header) {
  const m = /^H: (.+)$/.exec(header ?? '')
  return m ? m[1].replace(/^ShapePilot\s+/, '').replace(/\.stl$/i, '').trim() || null : null
}
