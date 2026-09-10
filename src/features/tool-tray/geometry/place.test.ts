import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { freeSpotFor } from './place.ts'
import { pocketFootprint } from './shapes.ts'
import { emptyDesign } from '../model/defaults.ts'
import { PART_PRESETS } from '../model/partPresets.ts'
import type { PartPreset } from '../model/partPresets.ts'
import type { ToolPocket, ToolTrayDesign } from '../model/types.ts'
import { profileToMulti } from '../../../model/trayProfile.ts'
import { difference, intersection } from '../../../geometry/boolean.ts'
import { multiArea } from '../../../geometry/vec.ts'

/** The pocket the designer would create by dropping this preset here. */
const placed = (preset: PartPreset, at: { x: number; y: number }): ToolPocket => ({
  id: preset.id,
  kind: preset.kind,
  x: at.x,
  y: at.y,
  widthMm: preset.widthMm,
  heightMm: preset.heightMm,
  steps: preset.steps.map(s => ({ ...s })),
  ...(preset.fingerAccess ? { fingerAccess: { ...preset.fingerAccess } } : {}),
})

const drop = (design: ToolTrayDesign, preset: PartPreset): ToolTrayDesign => ({
  ...design,
  pockets: [...design.pockets, placed(preset, freeSpotFor(design, preset))],
})

describe('auto-placement reserves what the pocket actually takes', () => {
  // The bug this pins: the search reserved widthMm x heightMm plus a wall, but
  // every preset now brings finger access that reaches past that box. A spot
  // chosen without it puts the scoop through the outline or a neighbour --
  // which is a hole in the tray wall, not a cosmetic overlap.
  test('a dropped part lands wholly inside the outline, scoop and all', () => {
    let design = emptyDesign()
    const region = profileToMulti(design.profile)
    for (const preset of PART_PRESETS) {
      design = drop(design, preset)
      const pocket = design.pockets[design.pockets.length - 1]!
      const outside = difference(pocketFootprint(pocket), region)
      assert.ok(multiArea(outside) < 1e-6,
        `${preset.label} hangs ${multiArea(outside).toFixed(2)} mm² off the tray`)
    }
  })

  test('no two dropped parts overlap, counting their scoops', () => {
    let design = emptyDesign()
    for (const preset of PART_PRESETS) design = drop(design, preset)

    const footprints = design.pockets.map(pocketFootprint)
    for (let i = 0; i < footprints.length; i++) {
      for (let j = i + 1; j < footprints.length; j++) {
        const shared = multiArea(intersection(footprints[i]!, footprints[j]!))
        assert.ok(shared < 1e-6,
          `${design.pockets[i]!.id} and ${design.pockets[j]!.id} share `
          + `${shared.toFixed(2)} mm²`)
      }
    }
  })

  // Same preset, one with its scoop and one without: the one that needs more
  // room must not be handed the same spot, or the reservation is not being read.
  test('the scoop changes where a part will fit', () => {
    const design = emptyDesign()
    const wide = PART_PRESETS.find(p => p.fingerAccess?.side === 'left')
    assert.ok(wide, 'expected at least one preset scooped on its left')

    const bare: PartPreset = { ...wide, fingerAccess: undefined }
    const withScoop = freeSpotFor(design, wide)
    const without = freeSpotFor(design, bare)
    assert.ok(withScoop.x > without.x,
      'a left-hand scoop must be held off the left wall by its reach')
  })
})
