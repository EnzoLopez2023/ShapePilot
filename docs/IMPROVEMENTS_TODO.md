# Improvements to-do

From the September 2026 flow review of the Bambu Designer, AI Playground,
Filaments and EL-ement Statistics. Ordered within each section roughly by value
for effort. Tick items off here as they land.

## Done

- [x] Playground: a saved conversation is restored when the design is opened, and
      undo takes a turn back with its geometry (the document's `chat` is now the
      only transcript; `useAiDesigner` takes it as input).
- [x] Bambu Designer: the conversation is saved with the design too.
- [x] Applying an AI proposal merges into the scene (`src/csg/mergeProposal.ts`)
      instead of replacing it, so imports, top-level holes, hidden parts, and the
      colour/lock/editable text of untouched parts survive.

## Follow-ups found while fixing those

- [x] Bambu Designer: preview a proposal in the viewport before Apply. The panel
      says "Shown in the viewport as a preview" but only the Playground does it.
      Reuse the Playground's merged-preview effect.
- [x] Both: drop a pending question/proposal when a different document is opened
      or New is pressed, so an answer about one design cannot be applied to
      another.

## Bambu Designer — flow

### Drop to plate
- [x] Add `dropToPlate(ids)` in `align.ts`: per selected object, move Z by
      `-bounds.min[2]`, as one history entry (same shape as `align`).
- [x] Toolbar button (icon + tooltip "Drop to plate (D)").
- [x] `D` key shortcut in the page's keydown handler (skip when typing).
- [x] With nothing selected, move every object as one body (dropping each on its
      own would pull an assembly apart); the print warning's fix does the same.
- [x] Add a "Drop to plate" action button to the "below the build plate" print
      warning (`printChecks.ts` issue gains an optional `fix` id).
- [x] Unit test for `dropToPlate`; UI test for the shortcut.

### Arrow-key nudge
- [x] Arrow keys move the selection by the snap step in X/Y (1 mm when snap is Off).
- [x] Shift+arrow moves by 10× the step.
- [x] PageUp/PageDown (or Alt+↑/↓) nudge Z.
- [x] Hold repeated key presses to a single undo entry per burst (`replace` takes a
      `coalesce` key; presses within 1 s on the same selection join).
- [x] Skip locked objects.
- [x] UI test: arrow moves by snap, shift multiplies.

### Mirror on every axis
- [x] Replace the single mirror button with a menu: X / Y / Z.
- [x] `M` / `Shift+M` / `Option+M` mirror across X / Y / Z.
- [x] Update tooltip text.

### Consistency
- [x] Select all (⌘A) in the Bambu Designer: every unlocked top-level part.
- [x] The same in the Shaper Designer.
- [x] Save is disabled only for an empty design that was never saved, in all three
      designers (a saved design may be emptied on purpose).
- [x] Keyboard shortcuts popover (toolbar button, or `?`).

## Bambu Designer — features

### Per-part filament from the AMS
- [x] Optional `filamentSlot` (1-16) on scene objects, validated server-side and
      carried through AI merges.
- [x] "Filament" select for a selected top-level solid: Auto, or an AMS tray
      (A1-D4) with swatch, product and remaining %, from the last AMS report.
- [x] Choosing a tray paints the part in that spool's colour.
- [x] 3MF export: a chosen tray is the part's extruder; Auto parts take the lowest
      numbers nobody chose.
- [x] Warn when differently-coloured parts share a tray, or a chosen tray is empty.
- [x] Without an AMS report (non-admin, no connection) trays are offered by number.
- [x] Tests: tray numbering, extruder assignment, warnings, validation, export.
- [ ] Verify with a real export in Bambu Studio that a synced AMS list maps
      extruder N to tray N (the tooltip tells the user to sync).

### Weight, cost and stock estimate
- [x] Estimate grams from volume and surface area (two 0.42 mm walls + 15% infill;
      a 20 mm PLA cube comes out ~3.7 g), per material density from the tray.
- [x] "≈ N g" in the status bar, with a per-filament breakdown in its tooltip.
- [x] Grams per filament, numbered the way the 3MF export numbers them.
- [x] Warn when a tray's remaining % of a 1 kg spool is below what the model needs.
- [x] Cost beside the weight estimate, from the priced line of each chosen AMS
      tray; filament with no price is named in the tooltip, not guessed at.

### Parts library
- [x] The palette takes generated parts as well as files, grouped by category.
- [x] Screw clearance holes, countersunk and counterbored (M2-M5), from ISO sizes
      plus print clearance. Each is a hole group that cuts as one shape.
- [x] Heat-set insert pockets (M2-M5, brass inserts, blind from the top).
- [x] Hex nut traps (M2-M5, from the bottom; an extruded hexagon, because the
      kernel and the AI contract both require at least 8 segments on a cylinder).
- [x] A size/thickness dialog: with a part selected the cutter is sized to it and
      lands in its middle, ready to nudge and group.
- [ ] Gridfinity base unit — deferred. The profile is two 45° chamfers with
      rounded corners, and the scene has no loft or chamfer primitive; a stacked
      approximation would not seat in a real baseplate. Needs a new primitive.
- [ ] Skådis hook / peg — deferred. `src/geometry/skadis.ts` draws the board, not
      a hook, and the hook's fit needs test prints to settle.
- [ ] Print-test the fastener sizes and adjust the clearance table. The coupon
      is `npm run coupon:fasteners` (models/fastener-coupon): one 10 mm plate,
      every cutter, M3 and M4. Report tight/good/loose per feature, with a
      measured hole diameter where it is off, and the material.

### Better print checks
- [x] Overhang check: downward faces steeper than 45° that miss the plate, in mm²,
      measured per triangle on the finished model.
- [x] Small-contact-area warning: nothing flat on the plate at all, or a model
      tall and narrow over its footprint (height / √footprint > 4).
- [x] Average wall thickness (2V/A), reported as an average.
- [x] An issue with a position offers "Select the part", matched back by bounds
      because the checks run on the union, which has no object identity left.
- [ ] Minimum wall thickness, not just the average: a thin rib on a thick body
      does not move 2V/A. Needs a distance field or ray casts through the mesh.
- [x] "Show overhangs" draws the offending faces in the viewport, lifted clear of
      the surface they came from. Off by default: a permanently red underside
      would be noise on every model that needs supports and knows it.

## AI Playground

- [x] "Extrude" for a traced drawing: thickness plus an optional backing plate
      (margin, thickness), so a photographed logo becomes a badge in place. The
      artwork stands on the plate rather than intersecting it.
- [x] A 2D/3D switch for a flat design, since a trace is paths either way.
- [x] Proposed/Current toggle while a proposal is up, resetting per proposal.
- [x] Print issues moved to a chip on the viewport that opens the list.
- [x] The photo panel follows the tracer's own availability. Note: today both it
      and the shape assistant probe the same `/api/ai/status`, so an
      unconfigured deployment still has neither -- this only stops the panel
      following the wrong signal if they ever part company.
- [ ] Carry the per-part filament and weight estimate here once the shared hook
      exists (the Bambu Designer has them).

## Filaments

- [x] Search box filtering colours by name and maker's code, cleared with Esc.
- [x] "Owned only" switch next to "Hide discontinued", with an empty-result line.
- [x] Keyboard: `/` focuses search.
- [x] Estimated grams remaining per loaded spool (AMS % of a 1 kg spool), in the
      stock note; `SPOOL_GRAMS` is shared with the designer's estimate.
- [x] Price per kg per line, stored per account (`filament_prices`, migration 017)
      with an account currency; nothing converts between currencies.
- [x] Print usage shows what the filament cost, with unpriced grams named as
      unpriced rather than skipped.
- [x] Use a filament in a design: the Bambu Designer's Colour field offers the
      colours the account owns, matched by hex so a colour picked here and one
      taken from an AMS tray are the same value. Done in the designer rather
      than as a cross-page handoff from Filaments -- the designer is where a
      part is selected, and a handoff would have had nothing to apply to.

## EL-ement Statistics

### Flow
- [x] The scope form says "Not applied yet" while it differs from what the page
      is showing, and the Apply button reads "Filters applied" and is disabled
      when there is nothing to apply.
- [x] Keep the scroll position when a chart click re-filters: the previous
      report stays on screen, dimmed and `aria-busy`, while the next one loads,
      instead of collapsing the page to a skeleton.

### Features
- [x] Link jobs to designs: job detail offers "Open design" when the job title
      matches a saved design (normalised to letters and digits, with the
      slicer's plate number and extension stripped). An ambiguous match offers
      nothing, and the wording says it is a name match, not provenance.
- [x] On a design, show its print history: `GET /api/design-documents/:id/prints`
      (administrator-only, like the rest of the printer's history) matches job
      titles to the design name, and the Bambu Designer shows prints, failures,
      last printed and average grams, worded as a name match.
- [ ] Embed the design id in 3MF metadata on export, so matching stops depending
      on titles (check whether Bambu cloud returns it).
- [x] Success rate by material: each material row carries its jobs by outcome
      (server-side), and the table shows completed, failed and completed-of-
      settled, withheld below five settled jobs. The counts are in the
      materials CSV too.
- [ ] Success rate by model title — needs the design link above to group jobs by
      design first.
- [ ] Cost per print and per period in Statistics. Needs per-job colour
      attribution: a job reports material and colour, but the matcher works per
      colour across all history, so a per-job price needs that link first.
- [x] Recorded printing time on `/maintenance`: hours and job count from the
      statistics report, named as recorded cloud history rather than an odometer.
- [ ] Hour-based maintenance intervals, now that the hours are on the page. The
      schedule model is date-based throughout, so this is a model change.
- [x] Utilisation: jobs by hour of the day, aggregated server-side in the
      scope's time zone, with the numeric equivalent in the chart-data table.
      Undated jobs have no hour and are left out rather than piled on midnight.
