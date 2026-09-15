# Generated models

Printable output, committed so a set can be pinned to the revision that made
it. **Nothing here is edited by hand** — every file is regenerated from
`src/rack/`:

```
npm run rack:build              # models/rack
npm run rack:build -- --coupon  # models/rack-coupon
npm run rack:drawings           # the dimensioned sheets
```

A change to `src/rack/config.ts` therefore shows up as a diff in this
directory, which is the point: it is how you see that geometry moved.

## rack/

The full 6-bay Systainer3 S76 wall rack. 14 pieces plus two wall strips —
`README.txt` carries the print quantities, orientation and assembly order.

## rack-coupon/

Four small parts exercising all three joints at the real fit clearance. Print
these first and confirm the fit before committing to ~2.2 kg of filament.

## A note on size

These are ~55 MB of binaries and git keeps every version of each. If the
history gets heavy, the usual answers are Git LFS or pruning old revisions of
this directory; neither is set up today.
