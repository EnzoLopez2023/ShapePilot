// Generates lib/contracts/bambuFilaments.ts from scripts/filament-source.json.
//
// The source is a hand-maintained capture of 3dfilamentprofiles.com. That site
// is a Next.js RSC app with no public API and active rate limiting, so this
// script deliberately does NOT fetch: capturing the table is a manual step (see
// the header comment in the generated module), and this script only turns the
// captured JSON into a typed, deterministic module.
//
// What it is really for is the key rule. A filament's stored key is
// `<brand>/<material>/<type>/<colour-slug>-<code>`, and getting it wrong is
// unrecoverable once an account has ticked anything: the rows would orphan. So
// the rule lives in exactly one place, is applied the same way to every brand,
// and the uniqueness it depends on is proven here rather than assumed.
//
// `--check` regenerates and compares, the same contract as `npm run check:icons`.
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = resolve(root, 'scripts/filament-source.json')
const outputPath = resolve(root, 'lib/contracts/bambuFilaments.ts')

const checkOnly = process.argv.slice(2).includes('--check')
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== '--check')
if (unknownArguments.length > 0) {
  throw new Error(`Unknown filament catalogue argument: ${unknownArguments.join(', ')}`)
}

interface SourceLine {
  brand: string
  brandLabel: string
  material: string
  type: string
  label: string
  variants: string[]
}

interface SourceColor {
  name: string
  code?: string
  hexes: string[]
  discontinued?: boolean
}

interface Source {
  lines: SourceLine[]
  colors: Record<string, SourceColor[]>
}

const VARIANTS = new Set(['spool', 'refill'])
const HEX = /^#[0-9A-F]{6}$/

/**
 * Lowercase, non-alphanumerics to single hyphens, trimmed. Applied to the
 * colour name only -- the brand, material and type segments are already slugs,
 * because they are the site's own URL path.
 */
const slug = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const lineIdOf = (line: SourceLine): string => `${line.brand}/${line.material}/${line.type}`

/**
 * The code is part of the key, not decoration. Bambu ships the same colour name
 * at two codes when it revises a SKU -- PLA Basic has "Blue" at both 10600 and
 * 10601 -- so a name-only slug would collide and silently merge two products
 * into one checkbox. Brands that publish no code (most of them) fall back to the
 * name alone, and the uniqueness assertion below is what catches the day that
 * is not enough.
 */
const keyOf = (lineId: string, color: SourceColor): string =>
  `${lineId}/${slug(color.name)}${color.code ? `-${color.code}` : ''}`

const quote = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

function assertSource(source: Source): void {
  const lineIds = new Set<string>()
  for (const line of source.lines) {
    const id = lineIdOf(line)
    if (lineIds.has(id)) throw new Error(`duplicate line ${id}`)
    lineIds.add(id)
    if (line.variants.length === 0) throw new Error(`${id} declares no variants`)
    for (const variant of line.variants) {
      if (!VARIANTS.has(variant)) throw new Error(`${id} declares unknown variant ${variant}`)
    }
    if (!source.colors[id]) throw new Error(`${id} has no colours`)
  }
  for (const id of Object.keys(source.colors)) {
    if (!lineIds.has(id)) throw new Error(`colours for unknown line ${id}`)
  }

  const keys = new Set<string>()
  for (const [id, colors] of Object.entries(source.colors)) {
    for (const color of colors) {
      const key = keyOf(id, color)
      if (keys.has(key)) {
        throw new Error(
          `duplicate filament key ${key} -- two products in ${id} slug the same. `
          + 'Give one of them a distinguishing code in scripts/filament-source.json.',
        )
      }
      keys.add(key)
      if (color.hexes.length < 1 || color.hexes.length > 2) {
        throw new Error(`${key} has ${color.hexes.length} hexes; expected 1 or 2`)
      }
      for (const hex of color.hexes) {
        if (!HEX.test(hex)) throw new Error(`${key} has a malformed hex ${hex}`)
      }
    }
  }
}

function render(source: Source): string {
  const lines = source.lines.map((line) => {
    const variants = line.variants.map(quote).join(', ')
    return `  { brand: ${quote(line.brand)}, brandLabel: ${quote(line.brandLabel)}, `
      + `material: ${quote(line.material)}, type: ${quote(line.type)}, `
      + `label: ${quote(line.label)}, variants: [${variants}] },`
  })

  const colors: string[] = []
  for (const line of source.lines) {
    const id = lineIdOf(line)
    colors.push(`  // ${line.label} -- ${source.colors[id].length} colours`)
    for (const color of source.colors[id]) {
      const parts = [
        `key: ${quote(keyOf(id, color))}`,
        `line: ${quote(id)}`,
        `name: ${quote(color.name)}`,
      ]
      if (color.code) parts.push(`code: ${quote(color.code)}`)
      parts.push(`hexes: [${color.hexes.map(quote).join(', ')}]`)
      if (color.discontinued) parts.push('discontinued: true')
      colors.push(`  { ${parts.join(', ')} },`)
    }
  }

  return `// GENERATED FILE -- do not edit by hand.
//
// Run \`npm run filaments:generate\` after changing scripts/filament-source.json;
// \`npm run check:filaments\` proves the two are in step.
//
// The filament catalogue: which products exist, not which ones anybody owns.
// Ownership is per-account and lives in the filament_inventory table; this is
// the vocabulary that table's keys are drawn from, which is why it is committed
// code rather than data. A colour is identified by its full path --
// \`<brand>/<material>/<type>/<colour-slug>-<code>\` -- so that adding a brand is
// a catalogue change and never a migration.
//
// Source: 3dfilamentprofiles.com, captured by hand. That site is a Next.js RSC
// app with no public API and it rate-limits, so there is no fetching script to
// run: browse the \`/filaments/<brand>/<material>/<type>\` page (it paginates at
// 50), read the Colour and RGB columns, and add the rows to
// scripts/filament-source.json.
//
// The code is part of the key because Bambu reissues a colour under a new code
// when it revises a SKU, and both stay listed -- PLA Basic "Blue" is 10600
// (discontinued) and 10601. Codes are NOT unique across lines: ABS "Grey" and
// PLA Basic "Gray" are both 10103. The path is what disambiguates them.

/** How a spool is sold. Bambu's refills are the same filament with no reel. */
export type FilamentVariant = 'spool' | 'refill'

/** One product line: a brand's material in one finish. */
export interface FilamentLine {
  /** Slug, as it appears in the source site's URL. */
  readonly brand: string
  readonly brandLabel: string
  readonly material: string
  readonly type: string
  /** What the maker calls it, e.g. 'PLA Basic'. */
  readonly label: string
  /** Every way this line can be bought; one checkbox per entry. */
  readonly variants: readonly FilamentVariant[]
}

export interface FilamentColor {
  /** \`<brand>/<material>/<type>/<colour-slug>-<code>\`. The stored key. */
  readonly key: string
  /** \`<brand>/<material>/<type>\`, matching a FilamentLine. */
  readonly line: string
  readonly name: string
  /** The maker's own code. Display only -- most brands publish none. */
  readonly code?: string
  /** One entry, or two for a dual-colour filament. Uppercase \`#RRGGBB\`. */
  readonly hexes: readonly string[]
  /** Still listed, no longer made. Kept: a spool you own outlives its SKU. */
  readonly discontinued?: true
}

export const FILAMENT_LINES: readonly FilamentLine[] = Object.freeze([
${lines.join('\n')}
])

/** Catalogue order is display order: lines as listed, colours alphabetical. */
export const FILAMENT_CATALOG: readonly FilamentColor[] = Object.freeze([
${colors.join('\n')}
])

const BY_KEY = new Map(FILAMENT_CATALOG.map((color) => [color.key, color]))
const BY_LINE = new Map(FILAMENT_LINES.map((line) => [
  \`\${line.brand}/\${line.material}/\${line.type}\`, line,
]))

export const filamentByKey = (key: string): FilamentColor | undefined => BY_KEY.get(key)

export const filamentLineById = (id: string): FilamentLine | undefined => BY_LINE.get(id)

export const filamentsOfLine = (id: string): FilamentColor[] =>
  FILAMENT_CATALOG.filter((color) => color.line === id)

/**
 * Whether this filament can be bought in this form. The server rejects a tick
 * that fails this, so a refill of a line Bambu only sells on a reel can never
 * be stored.
 */
export const isFilamentVariantFor = (key: string, variant: string): boolean => {
  const color = BY_KEY.get(key)
  if (!color) return false
  const line = BY_LINE.get(color.line)
  return line ? (line.variants as readonly string[]).includes(variant) : false
}

/** Every (key, variant) pair the catalogue allows. The upper bound on a tick set. */
export const FILAMENT_PAIR_COUNT = FILAMENT_CATALOG.reduce(
  (total, color) => total + (BY_LINE.get(color.line)?.variants.length ?? 0), 0)
`
}

const source = JSON.parse(await readFile(sourcePath, 'utf8')) as Source
assertSource(source)
const rendered = render(source)

if (checkOnly) {
  const existing = await readFile(outputPath, 'utf8').catch(() => null)
  if (existing !== rendered) {
    throw new Error(
      'lib/contracts/bambuFilaments.ts has drifted from scripts/filament-source.json; '
      + 'run npm run filaments:generate',
    )
  }
  console.log(`Filament catalogue is canonical (${source.lines.length} lines).`)
} else {
  await writeFile(outputPath, rendered)
  console.log(`Generated the filament catalogue (${source.lines.length} lines).`)
}
