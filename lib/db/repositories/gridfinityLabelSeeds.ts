// The label lists every account is given the first time it opens the Gridfinity
// designer. Each has a stable `key` so it is given once: delete it and it stays
// deleted, rename it and it is not added again under its old name.
//
// Labels are kept short on purpose -- they are printed as raised text on a
// 42 mm-wide bin's label tab, so `1-1/4" Coarse` rather than the full product
// name.

export interface LabelSeed {
  readonly key: string
  readonly name: string
  readonly items: readonly string[]
}

/** Kreg pocket-hole screws: thread, finish and length as sold. */
export const KREG_POCKET_SCREWS: LabelSeed = {
  key: 'kreg-pocket-screws-v1',
  name: 'Kreg pocket screws',
  items: [
    // #8 coarse, washer head (Maxi-Loc), zinc -- softwood, plywood, MDF
    '1" Coarse',
    '1-1/4" Coarse',
    '1-1/2" Coarse',
    '2" Coarse',
    '2-1/2" Coarse',
    // #7 fine, washer head, zinc -- hardwood
    '1" Fine',
    '1-1/4" Fine',
    '1-1/2" Fine',
    // #6 fine, pan head -- 1/2" stock
    '3/4" Fine Pan',
    // #8 coarse, pan head
    '1" Coarse Pan',
    // #8 coarse, Blue-Kote (Protec-Kote) -- outdoor
    '1-1/4" Blue-Kote',
    '1-1/2" Blue-Kote',
    '2" Blue-Kote',
    '2-1/2" Blue-Kote',
    // #8 coarse, 305 stainless
    '1-1/4" Stainless',
    '1-1/2" Stainless',
    '2-1/2" Stainless',
    // #14 heavy duty, for the HD jig
    '2-1/2" HD',
  ],
}

/** Sizes transcribed from the three assortment-box labels. */
export const HANTOF_SELF_TAPPING_SCREWS: LabelSeed = {
  key: 'hantof-self-tapping-screws-1200-v1',
  name: 'HanTof self-tapping screws (1200 pcs)',
  items: [
    'M2 x 6 Self-tap',
    'M2 x 8 Self-tap',
    'M2 x 10 Self-tap',
    'M2 x 12 Self-tap',
    'M2.5 x 6 Self-tap',
    'M2.5 x 8 Self-tap',
    'M2.5 x 10 Self-tap',
    'M2.5 x 12 Self-tap',
    'M3 x 6 Self-tap',
    'M3 x 8 Self-tap',
    'M3 x 10 Self-tap',
    'M3 x 12 Self-tap',
  ],
}

export const FGRUH_M3_BOLT_ASSORTMENT: LabelSeed = {
  key: 'fgruh-m3-bolt-assortment-2300-v1',
  name: 'Fgruh M3 bolts, nuts and washers (2300 pcs)',
  items: [
    'M3 x 6 Button',
    'M3 x 8 Button',
    'M3 x 10 Button',
    'M3 x 12 Button',
    'M3 x 16 Button',
    'M3 x 20 Button',
    'M3 x 25 Button',
    'M3 x 30 Button',
    'M3 x 35 Button',
    'M3 x 4 Socket cap',
    'M3 x 6 Socket cap',
    'M3 x 8 Socket cap',
    'M3 x 12 Socket cap',
    'M3 x 16 Socket cap',
    'M3 x 20 Socket cap',
    'M3 x 25 Socket cap',
    'M3 x 30 Socket cap',
    'M3 x 35 Socket cap',
    'M3 Hex nuts',
    'M3 Flat washers',
    'M3 Split washers',
  ],
}

export const KADRICK_THREADED_INSERTS: LabelSeed = {
  key: 'kadrick-threaded-inserts-520-v1',
  name: 'Kadrick threaded inserts (520 pcs)',
  items: [
    'M2 Insert H2 mm',
    'M2 Insert H3 mm',
    'M2 Insert H4 mm',
    'M3 Insert H3 mm',
    'M3 Insert H4 mm',
    'M3 Insert H5 mm',
    'M3 Insert H6 mm',
    'M3 Insert H8 mm',
    'M4 Insert H8 mm',
    'M4 Insert H10 mm',
    'M5 Insert H10 mm',
    'M5 Insert H12 mm',
  ],
}

export const LABEL_SEEDS: readonly LabelSeed[] = [
  KREG_POCKET_SCREWS,
  HANTOF_SELF_TAPPING_SCREWS,
  FGRUH_M3_BOLT_ASSORTMENT,
  KADRICK_THREADED_INSERTS,
]
