// Regenerate the page-backdrop photographs from text prompts.
//
// These are the full-bleed images `PageBackdrop` lays under the Home page and
// the keycap-tray project gate. They are identity assets, not stock slots, so
// this script exists to reproduce them deliberately rather than to run in CI:
// generation costs money and is non-deterministic, and the committed .jpg is
// the source of truth.
//
// Backed by the Azure AI Foundry `gpt-image-2` deployment on
// `enzol-mgr7gyi7-eastus2` (rg `rg-hearth-ai`, East US 2) -- the same resource
// the nintek apps share for build-time image assets. All config is non-secret and
// defaulted; the only thing you must supply is the key, and the script will
// fetch it via `az` when `IMAGEGEN_KEY` is unset.
//
// Usage:
//   node scripts/generate-backgrounds.ts             # only missing images
//   node scripts/generate-backgrounds.ts --force     # regenerate all
//   node scripts/generate-backgrounds.ts home        # just one, by name
//
// Env overrides: IMAGEGEN_ENDPOINT, IMAGEGEN_DEPLOYMENT, IMAGEGEN_API_VERSION,
// IMAGEGEN_KEY, IMAGEGEN_RG, IMAGEGEN_RESOURCE.
import { execFileSync } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'public/backgrounds')

const ENDPOINT = (process.env.IMAGEGEN_ENDPOINT
  ?? 'https://enzol-mgr7gyi7-eastus2.cognitiveservices.azure.com').replace(/\/+$/, '')
const DEPLOYMENT = process.env.IMAGEGEN_DEPLOYMENT ?? 'gpt-image-2'
const API_VERSION = process.env.IMAGEGEN_API_VERSION ?? '2025-04-01-preview'

// Shared closing clause: keep every backdrop subordinate to the interface that
// floats on it -- calm, matte, low local contrast, and no lettering the veil
// would have to hide.
const LOOK = 'Overhead flat-lay photograph, soft diffuse north-facing daylight, '
  + 'gentle shadows, shallow depth of field, fine film grain. Calm matte palette '
  + 'of oatmeal, putty, warm grey and one muted dusty-blue accent. Composed to '
  + 'the right and lower edges so the upper-left half stays near-empty surface. '
  + 'Understated editorial still life, low contrast, generous negative space. '
  + 'No text, no lettering, no numbers, no logos, no people, nothing centered.'

interface Background {
  name: string
  prompt: string
}

const BACKGROUNDS: Background[] = [
  {
    name: 'home',
    prompt:
      'A clean, quiet woodworking and electronics maker’s workbench on warm '
      + 'pale oak. Arranged loosely along the edges: a closed grey systainer-style '
      + 'tool case, a low-profile mechanical keyboard, a small pile of blank '
      + 'keycaps, a pair of brass calipers, a folded sheet of pale blueprint '
      + 'paper, a coping saw. Bare oak tabletop fills most of the frame. '
      + LOOK,
  },
  {
    name: 'keycap-tray',
    prompt:
      'A mechanical-keyboard keycap set laid out on kraft paper and dark grey '
      + 'tool-case foam. Tidy rows of doubleshot PBT keycaps in muted slate grey '
      + 'and warm beige with a single soft dusty-blue accent key, a grey foam '
      + 'insert with cut pockets, steel tweezers, two loose switches. Plain '
      + 'kraft paper fills the open upper-left. '
      + LOOK,
  },
]

function resolveKey(): string {
  const fromEnv = process.env.IMAGEGEN_KEY?.trim()
  if (fromEnv) return fromEnv
  const rg = process.env.IMAGEGEN_RG ?? 'rg-hearth-ai'
  const name = process.env.IMAGEGEN_RESOURCE ?? 'enzol-mgr7gyi7-eastus2'
  try {
    return execFileSync(
      'az',
      ['cognitiveservices', 'account', 'keys', 'list', '-g', rg, '-n', name,
        '--query', 'key1', '-o', 'tsv'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
  } catch {
    throw new Error(
      'No image-generation key. Set IMAGEGEN_KEY, or run `az login` so the '
      + 'script can read it from the shared Foundry resource.',
    )
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function generate(background: Background, key: string): Promise<void> {
  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/images/generations`
    + `?api-version=${API_VERSION}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: background.prompt,
      n: 1,
      size: '1536x1024',
      quality: 'high',
      output_format: 'png',
    }),
  })

  if (!response.ok) {
    let detail = ''
    try {
      detail = JSON.stringify(await response.json()).slice(0, 600)
    } catch {
      detail = (await response.text().catch(() => '')).slice(0, 600)
    }
    throw new Error(`gpt-image-2 HTTP ${response.status}: ${detail}`)
  }

  const payload = await response.json() as { data?: Array<{ b64_json?: string }> }
  const b64 = payload.data?.[0]?.b64_json
  if (!b64) throw new Error('gpt-image-2 returned no image data')

  const jpeg = await sharp(Buffer.from(b64, 'base64'))
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer()
  const outPath = resolve(outDir, `${background.name}.jpg`)
  await writeFile(outPath, jpeg)
  console.log(`✓ ${background.name}.jpg (${(jpeg.length / 1024).toFixed(0)} KB)`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const only = args.filter((arg) => !arg.startsWith('--'))
  const targets = only.length
    ? BACKGROUNDS.filter((b) => only.includes(b.name))
    : BACKGROUNDS

  if (only.length && targets.length !== only.length) {
    const known = BACKGROUNDS.map((b) => b.name).join(', ')
    throw new Error(`Unknown background(s): ${only.join(', ')}. Known: ${known}`)
  }

  await mkdir(outDir, { recursive: true })
  const key = resolveKey()

  let made = 0
  for (const background of targets) {
    const outPath = resolve(outDir, `${background.name}.jpg`)
    if (!force && await exists(outPath)) {
      console.log(`· ${background.name}.jpg exists — skipping (use --force)`)
      continue
    }
    console.log(`… generating ${background.name} via ${DEPLOYMENT}`)
    await generate(background, key)
    made += 1
  }
  console.log(made ? `Done — ${made} image(s) written to public/backgrounds/` : 'Nothing to do.')
}

main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
