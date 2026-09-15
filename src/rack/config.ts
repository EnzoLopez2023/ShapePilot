// Every number the Systainer3 S76 rack is built from, in one place.
//
// The rack is a stack of bays, each holding one case, split down the middle
// because a 265 mm case is wider than the X2D's 256 mm plate. Pieces are named
// by course (bottom cap / middle / top cap) and side (left / right), which is
// exactly the breakdown in the user's sketch.
//
// THE ONE THING TO READ TWICE: `caseHeightMm` is 76 -- caliper-verified by the
// user, FEET INCLUDED. A rack needs the feet-included figure because the case
// rests on its feet on a shelf. (`src/model/trayProfile.ts` records 71, which
// is the body without feet; both numbers are real and they measure different
// things.) The pitch is then 76 + headroom + shelf, NOT 76 total -- which is
// where the sketch's 76 mm middle piece grows to 82.2.

export interface RackConfig {
  /** Case external size, feet included. */
  caseWidthMm: number
  caseDepthMm: number
  caseHeightMm: number
  /** How many cases the rack holds. */
  bays: number

  /** Slack around the case. `clearTopMm` MUST exceed `frontLipHeightMm`. */
  clearSideMm: number
  clearTopMm: number
  clearDepthMm: number

  shelfMm: number
  wallMm: number

  /** Upstands on a shelf: a stop at the back, a retainer at the front. */
  backLipHeightMm: number
  backLipDepthMm: number
  frontLipHeightMm: number
  frontLipDepthMm: number

  /**
   * Outward swell of the wall at the course joint, to host the dovetail.
   *
   * It swells OUTWARD on purpose. Inward would eat bay width, and the case
   * already has only 1.5 mm a side. The boss has to be wider than the socket
   * by `minSocketWallMm` on each side -- see `checkConfig`, and see
   * `minSocketWallMm` for what happens when it is not.
   */
  bossOutMm: number
  bossHeightMm: number
  /**
   * Least material that may remain beside the socket, and the shoulder the
   * tongue bears on.
   *
   * This is the number that makes the joint real. The socket is cut
   * `railHeadMm + 2 x fitMm` wide into a boss `wallMm + bossOutMm` wide; what
   * is left carries the whole stack in tension. At 4 extrusion lines it is a
   * wall. Below one line the slicer drops it, the socket opens out the side of
   * the rack, and the dovetail becomes a butt joint that looks fine in a render.
   */
  minSocketWallMm: number

  /** Course-to-course sliding dovetail: rises from the top face of a piece. */
  railHeightMm: number
  railNeckMm: number
  railHeadMm: number

  /**
   * Left-to-right seam: a V tongue down one half, a matching groove down the
   * other, glued.
   *
   * It replaced flared tabs, and the win is that a V is CONSTANT ALONG THE
   * DEPTH -- which is the print axis. No staircase, no overhang, no bands: the
   * whole joint lives in the cross-section. The tabs needed ~250 breakpoints a
   * piece and still left one flank overhanging.
   *
   * Glue carries the tension the tabs' undercut used to. The V still earns its
   * keep unglued: it locates the halves and stops them sliding vertically past
   * each other, which is the direction the tabs left free.
   */
  seamVeeDepthMm: number


  /** Clearance on every mating feature. Dial this from a coupon print. */
  fitMm: number

  /**
   * French cleat. The wall strip stands the rack off the wall by this much,
   * and it is also the run of the 45 degree bearing bevel.
   *
   * WHICH WAY THE BEVEL FACES is the thing to get right. The rack has to be
   * pulled TOWARD the wall as it settles, so the bearing plane must be low at
   * the wall and high away from it -- then sliding down is sliding in. The
   * rack's back face is z=0 and the wall is at z=-cleatThicknessMm, so the
   * plane RISES with z.
   *
   * That is also why neither part needs support. The hook's underside IS that
   * plane, so going up the print its underside rises and material only ever
   * ENDS. The strip prints outer-face down, where its height falls the same
   * way.
   */
  cleatThicknessMm: number
  /**
   * Height of the bevel's high point, in the top cap's own frame.
   *
   * Kept as low as the bevel allows, because the cap has to release the clip
   * again in FRONT of the back face -- at one layer per layer, or the full
   * section reappears in mid-air -- and that release chamfer is exactly this
   * tall. At the wall face the plane sits on the cap's own bottom edge, which
   * is the lowest it can be and still run the full thickness.
   */
  cleatBevelTopMm: number
  /** How far the wall strip's body hangs below the bevel's low point. */
  cleatDropMm: number
  /**
   * Tread of the bevel staircase. Coarse on purpose: this is a MATING face,
   * not an overhang -- material ends across it rather than appearing -- so it
   * does not need the one-layer tread the shelf peaks do. The hook and the
   * strip are cut from the same staircase, so they seat face to face.
   */
  cleatTreadMm: number
  cleatScrewDiaMm: number
  cleatScrewHeadDiaMm: number
  cleatScrewHeadDepthMm: number
  cleatScrewsPerHalf: number
  /** Peg joining the two wall strips, so they cannot mount at different heights. */
  cleatPegMm: number


  /**
   * Cut the shelves back to a waffle: a perimeter frame and ribs around a grid
   * of openings.
   *
   * A grid, not long slots or plain cross ribs, and the print direction is why.
   * Depth is the print axis, so an opening ENDS in a bridge: the rib above it
   * appears in one layer, spanning the opening's width, anchored to the ribs
   * either side -- so every opening is peaked at the top and nothing bridges
   * at all. Ribs running only along the depth would need no peak either, but
   * they leave a strip of shelf at mid-depth with no material across the
   * width, and across the width is the direction it carries the case in.
   */
  skeletonShelf: boolean
  /** Solid margin at the wall, front and back edges. Clears the lip bands. */
  shelfFrameMm: number
  shelfRibMm: number
  /**
   * Cap on an opening ACROSS THE WIDTH. This is the expensive one: the peak is
   * half the opening's width, and every step of that peak is another band, so
   * narrow openings are much cheaper to mesh than wide ones.
   */
  shelfOpeningWidthMm: number
  /**
   * Cap on an opening ALONG THE DEPTH, which is the print axis. Costs nothing
   * extra -- the ribs between rows run straight up the print.
   */
  shelfOpeningDepthMm: number
  /**
   * Layer height, which is also the tread of every 45 degree face that has to
   * PRINT: the peak over each shelf opening, and the seam tabs' flanks.
   *
   * The shelf stands as a VERTICAL WALL in the print, so an opening is a hole
   * in a wall and its top is a horizontal roof -- which is why flat-topped
   * openings filled with tree supports. Peaking the top fixes it; the flat
   * bottom is left alone, because material ENDING as the print rises is free
   * and only material returning has to be held up.
   *
   * Nothing here can loft, so the peak is a staircase, and the tread has to be
   * exactly one layer. A slicer decides what to support from the difference
   * between consecutive sliced layers, not from facet normals: one layer of
   * tread per layer of rise slices as a true 45 degrees. Two layers of tread
   * slices as 26.6 degrees, under Bambu's 30 degree threshold, and the
   * supports come back.
   *
   * The cleat bevel is the exception and has its own coarser tread, because
   * there material ends across the face instead of appearing -- see
   * `cleatTreadMm`.
   */
  layerHeightMm: number
}

export const RACK: RackConfig = {
  caseWidthMm: 265,
  caseDepthMm: 171,
  caseHeightMm: 76,
  bays: 6,

  clearSideMm: 1.5,
  clearTopMm: 3.0,
  clearDepthMm: 2.0,

  shelfMm: 3.2,
  wallMm: 3.2,

  backLipHeightMm: 10,
  backLipDepthMm: 4,
  frontLipHeightMm: 2.5,
  frontLipDepthMm: 5,

  bossOutMm: 6.4,
  bossHeightMm: 10,
  minSocketWallMm: 1.6,

  railHeightMm: 5,
  railNeckMm: 4.4,
  railHeadMm: 6.0,

  seamVeeDepthMm: 2.0,

  fitMm: 0.15,

  skeletonShelf: true,
  shelfFrameMm: 12,
  shelfRibMm: 6,
  cleatThicknessMm: 12,
  cleatBevelTopMm: 12,
  cleatDropMm: 34,
  cleatTreadMm: 1.0,
  cleatScrewDiaMm: 4.5,
  cleatScrewHeadDiaMm: 9,
  cleatScrewHeadDepthMm: 4.5,
  cleatScrewsPerHalf: 3,
  cleatPegMm: 7,

  shelfOpeningWidthMm: 16,
  shelfOpeningDepthMm: 60,
  layerHeightMm: 0.2,
}

export interface RackDerived {
  /** Outer width at the shelf. Bosses stand `bossOutMm` proud of this. */
  rackWidthMm: number
  halfWidthMm: number
  /** Back lip + case + slack + front lip. This is also the PRINT HEIGHT. */
  rackDepthMm: number
  /** Clear opening a case drops into. */
  bayClearMm: number
  /** Floor-to-floor. */
  pitchMm: number
  capHeightMm: number
  middleHeightMm: number
  totalHeightMm: number
  /** Material beside the socket at its widest, per side. */
  socketWallMm: number
  /** Flat bearing face the tongue leaves on top of the boss, per side. */
  tongueShoulderMm: number
  /**
   * Solid margin on the seam edge of a shelf. Wider than the frame by the
   * depth of the V, so an opening can never break into the joint.
   */
  seamFrameMm: number
  /** Widest and tallest any single piece gets, for the plate check. */
  pieceWidthMm: number
  pieceDepthMm: number
}

export function derive(cfg: RackConfig): RackDerived {
  const rackWidthMm = cfg.caseWidthMm + 2 * cfg.clearSideMm + 2 * cfg.wallMm
  const bayClearMm = cfg.caseHeightMm + cfg.clearTopMm
  const pitchMm = bayClearMm + cfg.shelfMm
  const capHeightMm = bayClearMm / 2 + cfg.shelfMm
  return {
    rackWidthMm,
    halfWidthMm: rackWidthMm / 2,
    rackDepthMm:
      cfg.backLipDepthMm + cfg.caseDepthMm + cfg.clearDepthMm + cfg.frontLipDepthMm,
    bayClearMm,
    pitchMm,
    capHeightMm,
    middleHeightMm: pitchMm,
    totalHeightMm: 2 * capHeightMm + (cfg.bays - 1) * pitchMm,
    socketWallMm: (cfg.wallMm + cfg.bossOutMm - cfg.railHeadMm - 2 * cfg.fitMm) / 2,
    tongueShoulderMm: (cfg.wallMm + cfg.bossOutMm - cfg.railHeadMm) / 2,
    seamFrameMm: cfg.seamVeeDepthMm + cfg.fitMm + cfg.shelfFrameMm,
    // A left piece runs from its boss face out to the tip of a seam tab.
    pieceWidthMm: rackWidthMm / 2 + cfg.bossOutMm + cfg.seamVeeDepthMm,
    pieceDepthMm:
      cfg.backLipDepthMm + cfg.caseDepthMm + cfg.clearDepthMm + cfg.frontLipDepthMm,
  }
}

/** Reasons a config cannot be built, in plain words. Empty means it is sound. */
export function checkConfig(cfg: RackConfig): string[] {
  const out: string[] = []
  const d = derive(cfg)
  if (cfg.frontLipHeightMm * 2 > cfg.frontLipDepthMm) {
    out.push(
      `a ${cfg.frontLipHeightMm} mm lip needs a ${cfg.frontLipHeightMm * 2} mm band to ramp up and ` +
      `back down at 45 degrees, but the band is ${cfg.frontLipDepthMm} mm -- it would appear too ` +
      'abruptly to print without support',
    )
  }
  if (cfg.frontLipHeightMm >= cfg.clearTopMm) {
    out.push(
      `front lip ${cfg.frontLipHeightMm} needs headroom to lift over, but clearTop is ` +
      `${cfg.clearTopMm} -- the case could not be removed`,
    )
  }
  if (cfg.railHeightMm > cfg.bossHeightMm) {
    out.push(`rail ${cfg.railHeightMm} is deeper than the boss ${cfg.bossHeightMm} can socket`)
  }
  // NOT `railHead <= boss`. That bound ignores the fit clearance and asks for
  // no material to be left over, and it passed a boss that left 0.05 mm a side
  // -- an eighth of one extrusion line.
  if (d.socketWallMm < cfg.minSocketWallMm) {
    out.push(
      `only ${d.socketWallMm.toFixed(2)} mm of wall beside the socket (want ` +
      `${cfg.minSocketWallMm}) -- a ${cfg.railHeadMm} mm head plus ${2 * cfg.fitMm} mm of fit in a ` +
      `${(cfg.wallMm + cfg.bossOutMm).toFixed(1)} mm boss. Widen bossOutMm or shrink the rail`,
    )
  }
  if (cfg.railNeckMm < 2.4) {
    out.push(`a ${cfg.railNeckMm} mm neck is too slender to survive handling`)
  }
  if (cfg.railNeckMm >= cfg.railHeadMm) {
    out.push('rail neck must be narrower than the head or the dovetail does not lock')
  }
  if (cfg.bays < 1) out.push('a rack needs at least one bay')
  if (cfg.seamVeeDepthMm <= 0) out.push('the seam needs a V to locate on')
  if (cfg.seamVeeDepthMm > cfg.shelfMm * 2) {
    out.push(
      `a ${cfg.seamVeeDepthMm} mm V on a ${cfg.shelfMm} mm plate is too slender to print or glue`,
    )
  }
  if (cfg.cleatBevelTopMm >= d.capHeightMm) {
    out.push(
      `the cleat bevel tops out at ${cfg.cleatBevelTopMm} but the top cap is only ` +
      `${d.capHeightMm.toFixed(1)} tall -- the hook would have no piece to hang from`,
    )
  }
  if (cfg.cleatBevelTopMm < cfg.cleatThicknessMm) {
    out.push(
      `a ${cfg.cleatBevelTopMm} mm bevel top cannot run a full ${cfg.cleatThicknessMm} mm of ` +
      'thickness without dropping below the cap',
    )
  }
  // The strip is shortest at the wall face; everything in it has to fit there.
  const lowestTop = cfg.cleatDropMm - cfg.fitMm
  if (cfg.cleatScrewHeadDiaMm + 12 > lowestTop) {
    out.push(
      `a ${cfg.cleatScrewHeadDiaMm} mm screw head does not fit under the bevel at the wall ` +
      `face, where the strip is only ${lowestTop.toFixed(1)} mm tall`,
    )
  }
  if (cfg.skeletonShelf) {
    if (cfg.shelfFrameMm <= cfg.backLipDepthMm || cfg.shelfFrameMm <= cfg.frontLipDepthMm) {
      out.push(
        `a ${cfg.shelfFrameMm} mm shelf frame does not clear the lip bands ` +
        `(${cfg.backLipDepthMm} back, ${cfg.frontLipDepthMm} front) -- a lip would stand over a hole`,
      )
    }
    if (d.seamFrameMm <= cfg.seamVeeDepthMm + cfg.fitMm) {
      out.push('the seam frame is narrower than the groove cut into it')
    }
    const usableX = d.halfWidthMm - d.seamFrameMm - cfg.wallMm - cfg.shelfFrameMm
    if (usableX <= cfg.shelfRibMm) {
      out.push(`nothing left to open up between the frames (${usableX.toFixed(1)} mm)`)
    }
  }
  return out
}

