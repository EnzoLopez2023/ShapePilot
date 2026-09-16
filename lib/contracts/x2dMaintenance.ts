// The X2D maintenance catalogue: which jobs a printer has, not when anyone did
// them. Doing them is per-account and lives in `maintenance_events`; this is the
// vocabulary that table's `task_key` column is drawn from, which is why it is
// committed code rather than data -- the same arrangement the filament
// catalogue and its inventory table use.
//
// Source: Bambu Lab's own wiki, captured by hand on 2026-09-15.
//
//   https://wiki.bambulab.com/en/x2d/maintenance/periodic-maintenance
//   https://wiki.bambulab.com/en/filament-acc/acc/pei-plate-clean-guide
//
// Every interval carries a `basis` saying who chose the number. Bambu states a
// cadence for four of these jobs and no cadence at all for the rest -- it says
// "regularly" and leaves it there. Inventing a number is the only way to put
// such a job on a calendar, so the ones we invented say so, in the catalogue and
// on screen. A schedule that cannot tell you whose opinion it is, is a schedule
// you cannot argue with.
//
// The three schedule kinds exist because the wiki genuinely has three. A lead
// screw is due on a date; a cutter blade is due after so many rolls, whenever
// those happen to fall; and a PTFE tube is due when it starts to slide, which is
// not a date at all and must never be rendered as one.

/**
 * How hard this printer is worked. Bambu tiers the axis intervals by daily
 * print hours, and these are its own three bands.
 */
export type UsageTier = 'high' | 'regular' | 'low'

export const USAGE_TIERS: readonly { tier: UsageTier; label: string; detail: string }[] =
  Object.freeze([
    { tier: 'high', label: 'Heavy', detail: '5 or more hours of printing a day' },
    { tier: 'regular', label: 'Regular', detail: '1 to 5 hours of printing a day' },
    { tier: 'low', label: 'Light', detail: 'under an hour of printing a day' },
  ])

/** What the filament cutter is mostly cutting; it wears at two rates. */
export type FilamentWear = 'standard' | 'abrasive'

export const FILAMENT_WEARS: readonly { wear: FilamentWear; label: string; detail: string }[] =
  Object.freeze([
    { wear: 'standard', label: 'Standard', detail: 'PLA, PETG, ABS, PC and the like' },
    { wear: 'abrasive', label: 'Abrasive', detail: 'PA+CF, PA+GF, PPA+CF and other filled filaments' },
  ])

/** Who chose the interval. Displayed, because the two do not carry equal weight. */
export type IntervalBasis = 'bambu' | 'shapepilot'

/** Days between services, by how hard the printer is worked. */
export interface TieredDays {
  readonly high: number
  readonly regular: number
  readonly low: number
}

/** An inclusive range of filament rolls. */
export interface RollRange {
  readonly min: number
  readonly max: number
}

export type MaintenanceSchedule =
  /** Due on a date: `days` after the last time it was done. */
  | {
    readonly kind: 'interval'
    readonly days: number | TieredDays
    readonly basis: IntervalBasis
  }
  /**
   * Due because something else was done. Full calibration has no cadence of its
   * own -- it is what you do after disturbing the axes, so it falls due the
   * moment one of `after` is logged later than the calibration itself.
   */
  | {
    readonly kind: 'follows'
    readonly after: readonly string[]
  }
  /** Due after so many rolls of filament, at two rates by what is being cut. */
  | {
    readonly kind: 'rolls'
    readonly standard: RollRange
    readonly abrasive: RollRange
    readonly basis: IntervalBasis
  }
  /**
   * Not due on any schedule. Replaced when a symptom appears, so it belongs on
   * a watch list and never on a calendar grid.
   */
  | {
    readonly kind: 'condition'
    readonly trigger: string
  }

export type MaintenanceGroup = 'motion' | 'extruder' | 'surface' | 'consumables'

export const MAINTENANCE_GROUPS: readonly { group: MaintenanceGroup; label: string }[] =
  Object.freeze([
    { group: 'motion', label: 'Motion and frame' },
    { group: 'extruder', label: 'Extruder' },
    { group: 'surface', label: 'Build surface and optics' },
    { group: 'consumables', label: 'Wear parts' },
  ])

export interface MaintenanceTask {
  /** Stable id. The stored `task_key`; never reuse one for a different job. */
  readonly key: string
  readonly title: string
  readonly group: MaintenanceGroup
  /** One line, in the imperative. What you are about to go and do. */
  readonly summary: string
  readonly schedule: MaintenanceSchedule
  /** The procedure, condensed from the wiki. Each step is one action. */
  readonly steps: readonly string[]
  /** Things that damage the printer or the plate if got wrong. */
  readonly cautions?: readonly string[]
  readonly supplies: readonly string[]
  /** Where the procedure came from, so the full version is one click away. */
  readonly source: string
}

const PERIODIC = 'https://wiki.bambulab.com/en/x2d/maintenance/periodic-maintenance'
const PEI = 'https://wiki.bambulab.com/en/filament-acc/acc/pei-plate-clean-guide'

/** Catalogue order is display order. */
export const MAINTENANCE_TASKS: readonly MaintenanceTask[] = Object.freeze([
  {
    key: 'chamber-clean',
    title: 'Clean inside the chamber',
    group: 'motion',
    summary: 'Sweep out filament debris before it reaches the moving parts.',
    // Bambu describes this job in full and never says how often. Tied to the XY
    // cadence because the chamber is already open when you lubricate the axes,
    // and debris at the lead screw base is what jams the Z axis.
    schedule: { kind: 'interval', days: { high: 30, regular: 60, low: 90 }, basis: 'shapepilot' },
    steps: [
      'Power the printer off and unplug it.',
      'Brush the chamber floor clear of filament residue and foreign objects.',
      'Wipe the floor with a non-woven cloth and isopropyl alcohol, paying particular '
        + 'attention to the base of the lead screw and the linear shaft.',
      'Wipe the top lining inside the printer, removing stuck filament and stains.',
      'Pull the bottom belt by hand to lower the heatbed slowly, then clean the cooling '
        + 'fans on both sides of the chamber and the chamber walls.',
    ],
    cautions: [
      'Debris that reaches the moving parts causes XYZ jams and unusual noise during printing.',
    ],
    supplies: ['Brush', 'Non-woven cloth', 'Isopropyl alcohol'],
    source: PERIODIC,
  },
  {
    key: 'xy-axes',
    title: 'Clean and lubricate the X and Y axes',
    group: 'motion',
    summary: 'Wipe both linear shafts down and re-oil them.',
    schedule: { kind: 'interval', days: { high: 30, regular: 60, low: 90 }, basis: 'bambu' },
    steps: [
      'Power the printer off and unplug it.',
      'Wipe the X-axis linear shaft back and forth until all oil stains and filament '
        + 'debris are gone, and check the belt surface while you are there.',
      'Apply lubricating oil along the shaft, 1 to 2 drops every 5 cm, on both the upper '
        + 'and lower linear shafts.',
      'Move the toolhead slowly along the whole X axis 3 to 5 times to spread the oil.',
      'Wipe both ends of the shaft with a lint-free cloth to remove the excess.',
      'Wipe the left and right Y-axis linear shafts with a non-woven cloth and isopropyl '
        + 'alcohol.',
      'Oil the Y-axis shafts at the same rate, move the toolhead along Y 3 to 5 times, '
        + 'then wipe off any excess.',
    ],
    cautions: [
      'Move the toolhead slowly. Moving it quickly pushes the oil onto the middle frame '
        + 'instead of letting the graphite bearing absorb it.',
    ],
    supplies: ['Lubricating oil', 'Non-woven cloth', 'Lint-free cloth', 'Isopropyl alcohol'],
    source: PERIODIC,
  },
  {
    key: 'z-axis',
    title: 'Clean and lubricate the Z axis',
    group: 'motion',
    summary: 'Deep-clean the three lead screws and grease them.',
    schedule: { kind: 'interval', days: { high: 90, regular: 120, low: 150 }, basis: 'bambu' },
    steps: [
      'Power the printer on and press the down button once to send the heatbed to its '
        + 'lowest position.',
      'Power the printer off and unplug it.',
      'Wipe the left and right lead screws, the linear shafts and the rear lead screw with '
        + 'a non-woven cloth dampened with alcohol, leaving no residue in the thread gaps.',
      'Clean the lead screw nuts and their contact areas, using tweezers to lift out '
        + 'filament residue.',
      'Apply lubricant grease evenly to all three lead screws, and lubricating oil to the '
        + 'left and right linear rails.',
      'Power on and run the heatbed from lowest to highest and back 3 to 5 times from the '
        + 'control panel to spread the grease and oil.',
      'Wipe the top and bottom down to remove oil, filament debris and other foreign matter.',
    ],
    cautions: [
      'Do not press the down button repeatedly. The heatbed can overshoot and strike the bottom.',
      'If the Z-axis belt squeaks, put a small drop of oil where the belt meets the '
        + 'tensioner idler.',
    ],
    supplies: ['Lubricant grease', 'Lubricating oil', 'Non-woven cloth', 'Isopropyl alcohol', 'Tweezers'],
    source: PERIODIC,
  },
  {
    key: 'full-calibration',
    title: 'Run a full calibration',
    group: 'motion',
    summary: 'Re-establish mechanical coordination after touching the axes.',
    schedule: { kind: 'follows', after: ['xy-axes', 'z-axis'] },
    steps: [
      'Open the calibration screen on the printer.',
      'Run Motor Noise Cancellation.',
      'Run Vibration Compensation.',
      'Run Auto Bed Levelling.',
    ],
    supplies: [],
    source: PERIODIC,
  },
  {
    key: 'extruder-quick-clean',
    title: 'Quick-clean the main extruder',
    group: 'extruder',
    summary: 'Blow the debris out of the extruder and oil the gear area.',
    // No cadence in the wiki: it says the extruder accumulates debris and needs
    // regular cleaning. Quarterly is our reading of "regular" for a job that
    // takes a few minutes and needs no disassembly.
    schedule: { kind: 'interval', days: 90, basis: 'shapepilot' },
    steps: [
      'Power the printer off and unplug it.',
      'Remove the PTFE tube from the filament inlet, then the hotend clamp block, then '
        + 'the left hotend.',
      'Blow compressed air downwards through the top filament inlet to clear the debris '
        + 'out of the extruder.',
      'Apply lubricant to the gear area on the side of the toolhead.',
    ],
    supplies: ['Compressed air', 'Lubricant grease'],
    source: PERIODIC,
  },
  {
    key: 'extruder-deep-clean',
    title: 'Deep-clean the main extruder',
    group: 'extruder',
    summary: 'Open the extruder housing, clear it out and grease the gear train.',
    // Also uncadenced in the wiki. Twice a year, because this one means taking
    // the gears apart and the wiki sends you to a separate disassembly guide.
    schedule: { kind: 'interval', days: 180, basis: 'shapepilot' },
    steps: [
      'Power the printer off and unplug it.',
      'Follow the X2D Extruder Clog Cleaning and Maintenance guide to take the extruder '
        + 'gears apart.',
      'Open the extruder housing and clear out accumulated filament debris and residue.',
      'Apply lubricant grease to both gear transmission areas to reduce gear wear.',
      'Reassemble, following the same guide in reverse.',
    ],
    supplies: ['Lubricant grease', 'Brush'],
    source: PERIODIC,
  },
  {
    key: 'pei-plate-clean',
    title: 'Wash the textured PEI plate',
    group: 'surface',
    summary: 'Degrease the plate with detergent so the first layer sticks.',
    // Uncadenced in both wikis -- "periodically". Fortnightly, because this is
    // the one job on the list whose neglect shows up as a failed print rather
    // than as wear, and the water test below tells you if you are wrong.
    schedule: { kind: 'interval', days: 14, basis: 'shapepilot' },
    steps: [
      'Take the plate out of the printer and hold it by the edges.',
      'Wet the plate with warm water.',
      'Apply dishwashing detergent evenly across the surface.',
      'Scrub with a sponge, scouring pad or plastic brush, working up a foam so the '
        + 'detergent reaches down into the texture.',
      'Rinse the detergent off with clean water and dry the plate with a paper towel.',
      'Check your work: water should sheet into a thin film. Water that runs off in '
        + 'streams and beads up means the plate is still contaminated.',
    ],
    cautions: [
      'Never clean textured PEI with acetone. It destroys the PEI surface.',
      'Use a detergent with no oils or moisturisers in it; they stay behind and ruin adhesion.',
      'Alcohol alone tends to spread the oils around the texture rather than lift them out. '
        + 'Detergent is the degreaser.',
      'Do not touch the print surface with your fingers afterwards. Handle the plate by its edges.',
    ],
    supplies: ['Dishwashing detergent', 'Sponge or plastic brush', 'Paper towel'],
    source: PEI,
  },
  {
    key: 'camera-clean',
    title: 'Clean the live view camera',
    group: 'surface',
    summary: 'Wipe the volatile deposits off the lens.',
    schedule: { kind: 'interval', days: 180, basis: 'bambu' },
    steps: [
      'Power the printer off and unplug it.',
      'Wipe the camera lens clean of volatile particle deposits.',
    ],
    cautions: [
      'Shorten this interval if you print a lot of ABS or other highly volatile materials.',
    ],
    supplies: ['Lint-free cloth', 'Isopropyl alcohol'],
    source: PERIODIC,
  },
  {
    key: 'filament-cutter-blade',
    title: 'Check the filament cutter blade',
    group: 'consumables',
    summary: 'Check the toolhead cutter for dullness and replace it if blunt.',
    schedule: {
      kind: 'rolls',
      standard: { min: 8, max: 12 },
      abrasive: { min: 6, max: 10 },
      basis: 'bambu',
    },
    steps: [
      'Power the printer off and unplug it.',
      'Inspect the toolhead filament cutter blade for wear and dullness.',
      'Replace it if it is dull, following the Filament Cutter Replacement Guide.',
    ],
    cautions: [
      'Repeated AMS unload failures usually mean the blade is no longer cutting through '
        + 'the filament. Check the blade first.',
    ],
    supplies: ['Replacement cutter blade'],
    source: PERIODIC,
  },
  {
    key: 'carbon-filter',
    title: 'Replace the activated carbon filter',
    group: 'consumables',
    summary: 'Swap the filter out once it is heavily contaminated.',
    schedule: { kind: 'condition', trigger: 'The filter is heavily contaminated.' },
    steps: [
      'Release the side locking tab and open the activated carbon filter cover.',
      'Remove the filter by its upper and lower handles.',
      'Fit the replacement filter.',
      'If the cover itself is heavily soiled, rinse it under running water and scrub it '
        + 'with a brush.',
    ],
    cautions: [
      'Dry the filter cover completely before refitting it. Residual moisture can reach '
        + 'nearby electronic components.',
    ],
    supplies: ['Replacement activated carbon filter', 'Brush'],
    source: PERIODIC,
  },
  {
    key: 'nozzle-wiper',
    title: 'Replace the silicone nozzle wiper',
    group: 'consumables',
    summary: 'Swap the wiper as soon as it is damaged or deformed.',
    schedule: { kind: 'condition', trigger: 'The silicone wiper is damaged or deformed.' },
    steps: [
      'Power the printer off and unplug it.',
      'Inspect the silicone nozzle wiper for damage and deformation.',
      'Replace it immediately if either is present, so the nozzle keeps being wiped clean.',
    ],
    supplies: ['Replacement silicone nozzle wiper'],
    source: PERIODIC,
  },
  {
    key: 'ptfe-tube',
    title: 'Replace the auxiliary PTFE tube',
    group: 'consumables',
    summary: 'Replace the tube once its clamped end has worn.',
    schedule: {
      kind: 'condition',
      trigger: 'With the locking nut secured, the PTFE tube still slides up and down.',
    },
    steps: [
      'Power the printer off and unplug it.',
      'With the PTFE tube locking nut secured, try to move the tube up and down.',
      'If it moves, the clamped end has worn and the fitting can no longer hold it. '
        + 'Replace the tube.',
      'Check both the auxiliary extruder outlet and the filament inlet of the right hotend.',
    ],
    cautions: [
      'A worn tube shows up in prints as stringing, poor retraction and generally degraded '
        + 'quality before you notice the tube itself.',
    ],
    supplies: ['Replacement PTFE tube'],
    source: PERIODIC,
  },
])

const BY_KEY = new Map(MAINTENANCE_TASKS.map(task => [task.key, task]))

export const maintenanceTaskByKey = (key: string): MaintenanceTask | undefined => BY_KEY.get(key)

export const isMaintenanceTaskKey = (key: string): boolean => BY_KEY.has(key)

export const tasksOfGroup = (group: MaintenanceGroup): MaintenanceTask[] =>
  MAINTENANCE_TASKS.filter(task => task.group === group)

export const MAINTENANCE_TASK_COUNT = MAINTENANCE_TASKS.length

/** Days between services for this task at this tier, or null if it is not dated. */
export function intervalDaysFor(task: MaintenanceTask, tier: UsageTier): number | null {
  if (task.schedule.kind !== 'interval') return null
  const { days } = task.schedule
  return typeof days === 'number' ? days : days[tier]
}

/** The roll range this task is checked at, given what the cutter is mostly cutting. */
export function rollRangeFor(task: MaintenanceTask, wear: FilamentWear): RollRange | null {
  if (task.schedule.kind !== 'rolls') return null
  return wear === 'abrasive' ? task.schedule.abrasive : task.schedule.standard
}
