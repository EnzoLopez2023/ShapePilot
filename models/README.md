# Generated models

Printable output, committed so a set can be pinned to the revision that made
it. **Nothing here is edited by hand** — every file is regenerated from a
script:

```
npm run rack:build              # models/rack
npm run rack:build -- --coupon  # models/rack-coupon
npm run rack:drawings           # the dimensioned sheets
npm run swatch:build            # models/filament-swatch
npm run swatch:labels           # the label sheet for those cards
npm run swatch:holder           # models/swatch-holder
npm run swatch:holder -- --coupon  # models/swatch-holder-coupon
```

A change to `src/rack/config.ts` therefore shows up as a diff in this
directory, which is the point: it is how you see that geometry moved.

## rack/

The full 6-bay Systainer3 S76 wall rack. 14 pieces plus two wall strips —
`README.txt` carries the print quantities, orientation and assembly order.

## rack-coupon/

Four small parts exercising all three joints at the real fit clearance. Print
these first and confirm the fit before committing to ~2.2 kg of filament.

## filament-swatch/

A filament sample card built around whatever size label your label maker
prints — a redraw of the widely-printed "Swatch 48", whose 30 x 20 pocket is
too small for a 50 x 30 label. `--label WxH` sets the label, `--steps N` the
number of rungs on the thickness ladder:

```
npm run swatch:build -- --label 50x30
```

`swatch:labels` writes `filament-labels.csv` and `.xlsx` beside it — one row
per catalogue colour, columns in the order they read on the label, for the
Niimbot app's Excel import. Filter with `--line`, `--brand` or `--keys`, and
choose what the QR carries with `--qr profile|key|none`.

The usual way to get a sheet is the **Label sheet** button on the Filaments
page, which exports exactly the rows it is showing — so *Owned only* gives you
your shelf. Both routes build the sheet from
`src/features/filaments/model/labels.ts`, so they cannot drift; this script
exists for the whole catalogue, a single line, and scripted runs.

## swatch-holder/

Somewhere for the swatch cards to live. A Skådis bar that carries five cards by
the shelf, and a VHB pad that carries one on the AMS or a dry box.

Both emit an **identical blade**, which is the whole point: a card comes off one
mount and goes onto another with the same one-handed motion, so the swatch
follows the spool. `README.txt` carries the print orientations (the bar stands
on its top edge; the pad prints back-down) and the install actions.

## swatch-holder-coupon/

Print these first. They settle the two things no test can see: how a prong
really fits your Skådis board — its thickness is assumed, never measured — and
how a blade really fits the slot in a card you have actually printed. The blade
ladder offers four thickness/lip pairs; keep the one that engages positively and
still releases one-handed.

## A note on size

These are ~55 MB of binaries and git keeps every version of each. If the
history gets heavy, the usual answers are Git LFS or pruning old revisions of
this directory; neither is set up today.
