import assert from 'node:assert/strict'
import { test } from 'vitest'
import { THEME_PALETTE_IDS } from '../../lib/contracts/themePalettes.ts'
import { contrast, luminance, PALETTES, paletteById, tokensFor } from './palettes.ts'
import { buildTheme } from './theme.ts'

// The targets theme.ts promises, held for every palette in both modes. These
// are what derivation enforces, so a failure here means a seed was chosen that
// the walk-to-contrast could not rescue.
for (const palette of PALETTES) {
  for (const mode of ['light', 'dark'] as const) {
    const t = palette[mode]
    const grounds = { canvas: t.canvas, surface: t.surface, surfaceSunken: t.surfaceSunken }

    test(`${palette.id} ${mode}: body and secondary text clear 7:1 and 4.5:1 on every ground`, () => {
      for (const [name, ground] of Object.entries(grounds)) {
        assert.ok(contrast(t.text, ground) >= 7,
          `text on ${name}: ${contrast(t.text, ground).toFixed(2)}`)
        assert.ok(contrast(t.textMuted, ground) >= 4.5,
          `textMuted on ${name}: ${contrast(t.textMuted, ground).toFixed(2)}`)
      }
    })

    test(`${palette.id} ${mode}: the accent reads as text and carries its own label`, () => {
      assert.ok(contrast(t.accent, t.surface) >= 4.5,
        `accent on surface: ${contrast(t.accent, t.surface).toFixed(2)}`)
      assert.ok(contrast(t.accentText, t.accent) >= 4.5,
        `accentText on accent: ${contrast(t.accentText, t.accent).toFixed(2)}`)
      assert.ok(contrast('#FFFFFF', t.tooltip) >= 4.5, 'tooltip text')
      for (const key of ['danger', 'warning', 'success'] as const) {
        assert.ok(contrast(t[key], t.surface) >= 4.5, `${key} on surface`)
      }
    })

    test(`${palette.id} ${mode}: the mode is really that mode`, () => {
      if (mode === 'dark') assert.ok(luminance(t.canvas) < 0.05, 'dark canvas is dark')
      else assert.ok(luminance(t.canvas) > 0.6, 'light canvas is light')
      assert.ok(contrast(t.borderStrong, t.surface) >= 3, 'borderStrong separates')
    })
  }
}

test('every id the server accepts has a palette to draw, and nothing else does', () => {
  assert.deepEqual(PALETTES.map(p => p.id), [...THEME_PALETTE_IDS])
})

test('workbench keeps the original hand-tuned values, so nobody sees a change unasked', () => {
  const light = tokensFor('workbench', 'light')
  const dark = tokensFor('workbench', 'dark')
  assert.equal(light.canvas, '#F2F1EE')
  assert.equal(light.accent, '#1F5C8B')
  assert.equal(dark.canvas, '#16171A')
  assert.equal(dark.accent, '#79B6E4')
  assert.equal(buildTheme('light').palette.primary.main, '#1F5C8B')
})

test('a palette choice reaches the MUI theme', () => {
  const theme = buildTheme('dark', 'aurora')
  assert.equal(theme.palette.background.default, paletteById('aurora').dark.canvas)
  assert.equal(theme.palette.primary.main, paletteById('aurora').dark.accent)
})
