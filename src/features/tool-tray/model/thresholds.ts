// The numbers the placement checks hold a tray to.
//
// All of these came out of hand-building a real S 76 insert for an X2D tool kit
// before the designer existed, so they are what a working tray actually needed
// rather than round figures.
export const THRESHOLDS = {
  /** Material kept between a pocket and the outside. */
  wallMm: 2.4,
  /** Least material between two pockets. Below this, error. */
  minWebMm: 3.0,
  /** What a comfortable web looks like. Below this but above the minimum, warn. */
  targetWebMm: 4.0,
  /**
   * Solid material kept around an underside lift recess, so the recess stays a
   * closed pocket in the underside instead of opening into whatever is above it.
   */
  reliefDamMm: 2.5,
  /**
   * Roof left over a lift recess when a step opts into `liftOverKeepOut`. Six
   * layers at 0.2 mm -- enough to bridge the recess without a support.
   */
  reliefRoofMm: 1.2,
  /**
   * Cap on how many distinct floor levels one tray may have. Every level is a
   * region through the clipper and the T-junction pass, both superlinear in
   * region count, and the level set is driven by user-supplied depths -- so
   * this is a real bound, not a tidiness rule.
   */
  maxDistinctLevels: 24,
} as const

/** Whole printed layers, rounded DOWN so a floor is never shallower than asked. */
export const snapDown = (mm: number, layerMm: number): number => {
  if (!(layerMm > 0)) return mm
  // The 1e-9 keeps a value already on a layer boundary from dropping a layer to
  // float noise -- the same guard the switch tray needed for its tier heights.
  return Math.floor(mm / layerMm + 1e-9) * layerMm
}
