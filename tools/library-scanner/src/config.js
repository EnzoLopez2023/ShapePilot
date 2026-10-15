// ~/.workshop-library.json — per-Mac settings for the organizer. Every key is
// optional; missing keys fall back to the defaults below.
//
// The file keeps its Workshop-era name on purpose: it holds this Mac's library
// root, intake folders and category keywords, and the Library moving to
// ShapePilot changed none of those. Only the server and the token changed.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const HOME = homedir()
export const CONFIG_PATH = process.env.WORKSHOP_LIBRARY_CONFIG ?? join(HOME, '.workshop-library.json')
const ONEDRIVE = join(HOME, 'Library/CloudStorage/OneDrive-Personal')

export const DEFAULT_CONFIG = {
  libraryRoot: join(ONEDRIVE, 'Documents/3D Print'),
  intakeRoots: [join(HOME, 'Downloads'), join(ONEDRIVE, 'Downloads')],
  indexOnlyRoots: [join(HOME, 'repos/ShapePilot/models')],
  cacheDir: join(HOME, 'Library/Caches/workshop-library'),
  trashDir: join(HOME, '.Trash'),
  serverUrl: 'https://shapepilot.nintek.com',
  deviceToken: null,
  helperPort: 47821,
  // Seconds a download must be unchanged before intake touches it.
  settleSeconds: 10,
  // Legacy top-level folders -> where their models go during migration.
  legacyFolders: {
    Review: { category: '_Inbox', status: 'inbox' },
    'Want to Print': { category: null, status: 'want' },
    Printed: { category: null, status: 'printed' },
    Reviewed: { category: '_Archive', status: 'skip' },
    'Files Genereated with ShapePilot': { category: 'ShapePilot', status: 'inbox' },
    'X2D stuff': { category: 'X2D', status: 'inbox' },
    'Pictures for source generation': { leave: true },
  },
  // Lower-case keywords used to guess a category from titles and part names.
  categoryKeywords: {
    Festool: ['festool', 'systainer', 'sys3', 'sys 3', 'sys-', 'mft', 'domino', 'bench dog', 'benchdog', 'tracksaw', 'track saw', 'ct 15', 'ct15'],
    Skadis: ['skadis', 'skådis', 'pegboard'],
    X2D: ['x2d', 'p2s', 'p1s', 'x1c', 'ams', 'bambu', 'filament', 'spool', 'swatch', 'nozzle', 'build plate', 'dry box', 'drybox', 'dessicant', 'desiccant'],
    'Shaper Origin': ['shaper', 'origin', 'workstation', 'tapeboard'],
  },
}

export function loadConfig(overrides = {}) {
  let file = {}
  if (existsSync(CONFIG_PATH)) {
    try {
      file = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    } catch (err) {
      throw new Error(`Could not parse ${CONFIG_PATH}: ${err.message}`)
    }
  }
  const config = { ...DEFAULT_CONFIG, ...file, ...overrides }
  config.libraryRoot = resolve(config.libraryRoot)
  config.intakeRoots = config.intakeRoots.map((p) => resolve(p))
  config.indexOnlyRoots = config.indexOnlyRoots.map((p) => resolve(p))
  return config
}

export function saveConfig(patch) {
  let file = {}
  if (existsSync(CONFIG_PATH)) file = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  writeFileSync(CONFIG_PATH, `${JSON.stringify({ ...file, ...patch }, null, 2)}\n`, { mode: 0o600 })
}

/** Guesses a category from free text using `categoryKeywords`; null when nothing matches. */
export function guessCategory(config, texts) {
  const haystack = texts.filter(Boolean).join(' \n ').toLowerCase()
  let best = null
  let bestHits = 0
  for (const [category, words] of Object.entries(config.categoryKeywords)) {
    const hits = words.filter((w) => haystack.includes(w)).length
    if (hits > bestHits) {
      best = category
      bestHits = hits
    }
  }
  return best
}
