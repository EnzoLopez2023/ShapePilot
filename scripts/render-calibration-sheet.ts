// Render the trace calibration sheet to PDF.
//
// `docs/trace-calibration-sheet.html` is itself generated, by
// scripts/build-calibration-sheet.ts. The .pdf beside it is the artefact that
// gets printed, and it is committed rather than built on demand: it needs a
// Chrome on the machine and never runs in CI.
//
// The PDF matters more here than it does for the cheat sheet. This document is
// only useful if it comes out of the printer at exactly the size it claims, and
// a PDF at 100% is far more dependable than a browser print dialog, which will
// cheerfully apply a scale factor nobody asked for.
//
// Usage:
//   node scripts/build-calibration-sheet.ts   # regenerate the HTML first
//   node scripts/render-calibration-sheet.ts
//
// Env override: CHROME_PATH.
import { execFileSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const SHEETS = ['trace-calibration-sheet', 'trace-calibration-sheet-dark']

// Chrome is the whole toolchain: the sheet is one @page-sized SVG in absolute
// millimetres, and Chrome's print path preserves that. No headless-browser
// dependency is worth carrying for one document.
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

for (const sheet of SHEETS) {
  const source = resolve(root, `docs/${sheet}.html`)
  const output = resolve(root, `docs/${sheet}.pdf`)
  execFileSync(chrome, [
    '--headless',
    '--disable-gpu',
    // Chrome's own header/footer would stamp a URL and date over the layout.
    '--no-pdf-header-footer',
    `--print-to-pdf=${output}`,
    source,
  ], { stdio: ['ignore', 'inherit', 'ignore'] })
  console.log(`rendered ${output}`)
}
