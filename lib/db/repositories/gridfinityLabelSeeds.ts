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

export const LABEL_SEEDS: readonly LabelSeed[] = [KREG_POCKET_SCREWS]
