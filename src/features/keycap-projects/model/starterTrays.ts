// The trays a new project starts with.
//
// A set fills a Systainer as a stack -- a top tray, two middles and a bottom --
// and that stack is already drawn once, in the owner's "Sample Tray" project.
// A new project copies those four rather than starting from one blank tray.
// The sample is ordinary data, found by name, so it can be edited like any
// other project and every later project picks the edits up.

/** The project the starter trays are copied from, matched without case. */
export const SAMPLE_PROJECT_NAME = 'Sample Tray'

/** The stack, top to bottom: the order the copies are made in. */
export const STARTER_TRAY_LABELS = ['Top', 'Middle 1', 'Middle 2', 'Bottom'] as const

/** Same limit the server puts on a tray name. */
const NAME_MAX_LENGTH = 200

export interface StarterSource {
  id: string
  projectName: string | null
  name: string
}

export interface StarterTray {
  /** The sample tray to copy. */
  sourceId: string
  /** Its place in the stack: "Top", "Middle 1", ... */
  label: string
}

const fold = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Whether a sample tray's name is this label. The sample's own trays may be
 * named plainly ("Top") or in the same style as the copies ("Sample Tray - Top").
 */
const isLabelled = (name: string, label: string): boolean => {
  const n = fold(name)
  const l = fold(label)
  return n === l || n.endsWith(` - ${l}`)
}

/**
 * The sample trays to copy into a new project, in stack order. A label with no
 * tray in the sample is skipped; no sample at all gives an empty list.
 */
export function pickStarterTrays(designs: readonly StarterSource[]): StarterTray[] {
  const sample = designs.filter(
    d => d.projectName !== null && fold(d.projectName) === fold(SAMPLE_PROJECT_NAME))
  const picked: StarterTray[] = []
  for (const label of STARTER_TRAY_LABELS) {
    const source = sample.find(d => isLabelled(d.name, label))
    if (source) picked.push({ sourceId: source.id, label })
  }
  return picked
}

/** "Ghost in the Shell - Top", with the project name clipped if it must be. */
export function starterTrayName(projectName: string, label: string): string {
  const suffix = ` - ${label}`
  const room = NAME_MAX_LENGTH - suffix.length
  return `${projectName.trim().slice(0, room).trimEnd()}${suffix}`
}
