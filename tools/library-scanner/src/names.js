// Filename and title cleanup for downloaded / generated model files.
//
// Download sites and browsers mangle names in predictable ways: "+" or %20 for
// spaces, " (4)" copy suffixes, stray inner extensions ("part.step.stl") and
// underscores. Everything here is pure so it can be unit-tested against the
// real names found in the library.

export const MODEL_EXTENSIONS = ['.gcode.3mf', '.3mf', '.stl', '.obj', '.step', '.stp']

const INNER_EXT = /\.(?:step|stp|stl|obj|3mf|f3d|gcode|scad|zip)$/i
const COPY_SUFFIX = /\s*\((?:\d+)\)$/
const GENERIC = /^(?:untitled(?:[ _-]?(?:model|tray))?|model|new model|object|part|plate|tray|base|lid|body|cover|test|copy|\d+)$/i
// Control characters are exactly what this strips out of file names.
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[/\\:*?"<>|\u0000-\u001f]/g
const MAX_TITLE = 80

/** Returns the model extension of `filename` (".gcode.3mf" wins over ".3mf"), or "". */
export function modelExtension(filename) {
  const lower = filename.toLowerCase()
  return MODEL_EXTENSIONS.find((ext) => lower.endsWith(ext)) ?? ''
}

export function isModelFile(filename) {
  return modelExtension(filename) !== '' && !filename.startsWith('._')
}

/** File kind used across the index: stl | 3mf | obj | step. Sliced 3MFs are still "3mf". */
export function modelKind(filename) {
  const ext = modelExtension(filename)
  if (ext === '.gcode.3mf' || ext === '.3mf') return '3mf'
  if (ext === '.stp') return 'step'
  return ext.slice(1)
}

export function isSlicedName(filename) {
  return modelExtension(filename) === '.gcode.3mf'
}

function decode(text) {
  const plusless = text.replace(/\+/g, ' ')
  try {
    return decodeURIComponent(plusless)
  } catch {
    return plusless
  }
}

/** True when the words are all lower case (so title-casing will not destroy intent). */
function isAllLower(text) {
  return /[a-z]/.test(text) && text === text.toLowerCase()
}

function titleCase(text) {
  return text.replace(/(^|[\s(\-[])(\p{Ll})/gu, (_, lead, ch) => lead + ch.toUpperCase())
}

/**
 * Cleans a filename stem into a human title.
 * "light+weight+skadis+shelf+-++sizes+v5 (4).gcode.3mf" -> "Light Weight Skadis Shelf - Sizes v5"
 */
export function cleanStem(filename) {
  const ext = modelExtension(filename)
  let stem = ext ? filename.slice(0, -ext.length) : filename.replace(/\.[^.]+$/, '')
  stem = decode(stem)
  // Copy suffixes and stray inner extensions can alternate: "x.step (2)".
  for (let i = 0; i < 4; i += 1) {
    const before = stem
    stem = stem.replace(COPY_SUFFIX, '').replace(INNER_EXT, '').trim()
    if (stem === before) break
  }
  stem = stem
    .replace(/_+/g, ' ')
    .replace(ILLEGAL, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-_.]+|[\s\-_.]+$/g, '')
  if (isAllLower(stem)) {
    stem = titleCase(stem)
      .replace(/\bV(?=\d)/g, 'v')
      .replace(/\b(Mm|Cm|In)\b/g, (unit) => unit.toLowerCase())
      .replace(/\b(Pla|Petg|Abs|Asa|Tpu|Ams)\b/g, (word) => word.toUpperCase())
  }
  return stem
}

export function isGenericTitle(title) {
  return !title || GENERIC.test(title.trim())
}

/** Makes any string safe as a single macOS/OneDrive path component. */
export function safeComponent(text, fallback = 'Untitled model') {
  const cleaned = String(text ?? '')
    .replace(ILLEGAL, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, MAX_TITLE)
    .trim()
  return cleaned || fallback
}

/**
 * Picks the best display title for a file from, in order: 3MF Title metadata,
 * a ShapePilot STL header name, then the cleaned filename. Generic values
 * ("Untitled", "(10)") fall through to the next candidate.
 */
export function pickTitle({ filename, metaTitle, headerName, objectNames = [] }) {
  const candidates = [metaTitle, headerName, cleanStem(filename), objectNames.length === 1 ? cleanStem(objectNames[0]) : '']
  for (const candidate of candidates) {
    const value = candidate?.trim()
    if (value && !isGenericTitle(value)) return safeComponent(value)
  }
  return safeComponent(cleanStem(filename))
}

/** Clean destination filename: keeps the cleaned stem and the real extension. */
export function cleanFilename(filename) {
  const ext = modelExtension(filename) || (filename.match(/\.[^.]+$/)?.[0] ?? '')
  const stem = safeComponent(cleanStem(filename), 'model')
  if (ext.toLowerCase() === '.gcode.3mf') return `${stem} (sliced).gcode.3mf`
  return `${stem}${ext.toLowerCase()}`
}

/** Key used to group loose files that are obviously the same model (x.stl + x.3mf + x (2).3mf). */
export function groupKey(filename) {
  return cleanStem(filename).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** Returns `name`, or `name 2`, `name 3`... so that `taken(name)` is false. */
export function uniqueName(name, taken) {
  if (!taken(name)) return name
  const ext = modelExtension(name) || (name.match(/\.[^.]+$/)?.[0] ?? '')
  const stem = ext ? name.slice(0, -ext.length) : name
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem} ${n}${ext}`
    if (!taken(candidate)) return candidate
  }
  throw new Error(`No free name for ${name}`)
}
