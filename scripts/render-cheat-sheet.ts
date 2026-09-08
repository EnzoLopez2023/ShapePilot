// Render the print-settings cheat sheet to PDF.
//
// `docs/print-settings-cheat-sheet.html` is the source; the .pdf beside it is
// the artefact that gets printed and taped to the wall, so it is committed
// rather than built on demand. Like the backdrops, this script exists to
// reproduce that file deliberately and never runs in CI: it needs a Chrome on
// the machine, and the exact bytes it emits vary with the Chrome version.
//
// Usage:
//   node scripts/render-cheat-sheet.ts
//
// Env override: CHROME_PATH.
import { execFileSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = resolve(root, 'docs/print-settings-cheat-sheet.html')
const output = resolve(root, 'docs/print-settings-cheat-sheet.pdf')

// Chrome is the whole toolchain here: the sheet is styled with @page and CSS
// grid, and Chrome's print path is the one that renders it the way it looks in
// a browser. No headless-browser dependency is worth carrying for one document.
const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((path): path is string => typeof path === 'string' && path.length > 0)

const findChrome = (): string => {
  for (const candidate of CANDIDATES) {
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }
  throw new Error(
    `no Chrome found -- looked in:\n  ${CANDIDATES.join('\n  ')}\n`
    + 'Install Chrome or set CHROME_PATH to a Chromium-family binary.',
  )
}

const chrome = findChrome()

execFileSync(chrome, [
  '--headless',
  '--disable-gpu',
  // Chrome's own header/footer would stamp a URL and date over the layout.
  '--no-pdf-header-footer',
  `--print-to-pdf=${output}`,
  source,
], { stdio: ['ignore', 'inherit', 'ignore'] })

console.log(`rendered ${output}`)
