// How tall a keycap stands, by profile, and what that means for stacking.
//
// A cap drops into its pocket until the skirt meets the floor, so what stands
// above the rim is its own height less the pocket depth. The tray stacked on
// top rests on the corner posts, so the posts have to clear the tallest cap --
// but not by so much that the shortest cap can rise out of its pocket when the
// case is carried. Both ends of a sculpted profile matter: the spread between a
// profile's tallest and shortest row is what decides whether one post height
// can hold every cap in.
//
// Heights are skirt bottom to the highest point of the top, typical of each
// profile rather than of any one manufacturer. A caliper reading of the set in
// hand beats them, which the panel says.

export interface CapProfile {
  id: string
  label: string
  /** The shortest row, mm (R3 on a sculpted profile). */
  minHeightMm: number
  /** The tallest row, mm (R1 on a sculpted profile). */
  maxHeightMm: number
}

export const CAP_PROFILES: readonly CapProfile[] = [
  { id: 'cherry', label: 'Cherry', minHeightMm: 7.3, maxHeightMm: 9.4 },
  { id: 'dsa', label: 'DSA', minHeightMm: 7.6, maxHeightMm: 7.6 },
  { id: 'xda', label: 'XDA', minHeightMm: 9.1, maxHeightMm: 9.1 },
  { id: 'mda', label: 'MDA / KAT / KAM', minHeightMm: 9, maxHeightMm: 10.5 },
  { id: 'oem', label: 'OEM / OSA', minHeightMm: 9.5, maxHeightMm: 11.9 },
  { id: 'mt3', label: 'MT3', minHeightMm: 10.5, maxHeightMm: 14 },
  { id: 'sa', label: 'SA / KSA', minHeightMm: 12.5, maxHeightMm: 16.5 },
]

export const capProfileOf = (id: string | undefined): CapProfile | undefined =>
  CAP_PROFILES.find(p => p.id === id)

/**
 * The profile a project's free-text "Cap profile" names, if any. "KSA",
 * "Cherry profile", "GMK Cherry" and "oem" all resolve; a name that could be
 * two profiles resolves to the first listed.
 */
export function matchCapProfile(text: string | undefined): CapProfile | undefined {
  if (!text) return undefined
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  return CAP_PROFILES.find(p =>
    p.label.toLowerCase().split(/[^a-z0-9]+/).some(name => words.includes(name)))
}

/** Clear space kept above the tallest cap, so the tray above bears on no cap. */
export const HEADROOM_MM = 1
/** How much of the skirt must stay in the pocket for a cap to count as held. */
export const RETAIN_MM = 0.5
/** The Systainer3 S76 base cavity a stack is designed to. */
export const S76_STACK_MM = 48

const upToHalf = (mm: number): number => Math.ceil(mm * 2 - 1e-9) / 2

export interface PostAdvice {
  /** Corner post height above the rim, mm. 0 when every cap sits below the rim. */
  postMm: number
  /** How far the tallest cap stands above the rim, mm (negative: below it). */
  tallestProudMm: number
  /** Space between the shortest cap's top and the tray above, mm. */
  looseMm: number
  /** Whether even the shortest cap keeps its skirt in the pocket. */
  retained: boolean
  /** The shallowest whole-mm pocket that holds every row, when this one does not. */
  depthNeededMm?: number
  /** One tray's share of a stack: floor + pocket + post. */
  pitchMm: number
  /** Trays that fit in an S76 base. */
  traysInS76: number
}

export function advisePosts(
  profile: CapProfile, floorMm: number, depthMm: number,
): PostAdvice {
  const tallestProudMm = profile.maxHeightMm - depthMm
  const postMm = Math.max(0, upToHalf(tallestProudMm + HEADROOM_MM))
  // With no posts the tray above sits on the rim, so the room over a cap is
  // whatever of the pocket it does not fill -- the same sum either way.
  const looseMm = postMm + depthMm - profile.minHeightMm
  const retained = looseMm <= depthMm - RETAIN_MM
  const pitchMm = floorMm + depthMm + postMm
  const advice: PostAdvice = {
    postMm,
    tallestProudMm,
    looseMm,
    retained,
    pitchMm,
    traysInS76: pitchMm > 0 ? Math.floor((S76_STACK_MM + 1e-9) / pitchMm) : 0,
  }
  if (!retained) {
    // Once caps stand proud, the looseness is the profile's spread plus the
    // headroom, however deep the pocket -- so the pocket has to outgrow that.
    advice.depthNeededMm = Math.ceil(
      profile.maxHeightMm - profile.minHeightMm + HEADROOM_MM + RETAIN_MM - 1e-9)
  }
  return advice
}
