// Which saved design a recorded print came from.
//
// Nothing in the cloud record names a design: the only thread back is the job
// title, which is the file the slicer was given. An export from here is named
// after the design (`safeFilename`, so spaces and punctuation become
// underscores), and Bambu Studio appends a plate number and an extension. So
// the match is made on a normalised form of both -- letters and digits only --
// and it is offered as a likely match, never asserted: two designs can share a
// name, and a job title can be anything a person typed in the slicer.
import type { DocumentSummary } from '../../../services/designDocuments.ts'

/** Letters and digits, lower case; everything else is separator noise. */
const normalise = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** The slicer's own decorations around the name it was given. */
const stripDecorations = (title: string): string => title
  .replace(/\.(3mf|stl|obj|gcode|gcode\.3mf|step|stp)$/i, '')
  .replace(/[_\s-]*plate[_\s-]*\d+$/i, '')
  .replace(/[_\s-]*\(\d+\)$/, '')
  .trim()

export interface DesignMatch {
  document: DocumentSummary
  /** An exact normalised match, or the design's name inside a longer title. */
  exact: boolean
}

/**
 * The one design a job title points at, or null. Ambiguity is not resolved by
 * guessing: if two designs match equally well, neither is offered.
 */
export function matchDesign(
  title: string | null | undefined,
  documents: readonly DocumentSummary[],
): DesignMatch | null {
  const needle = normalise(stripDecorations(title ?? ''))
  if (needle.length < 3) return null

  const named = documents
    .map(document => ({ document, name: normalise(document.name) }))
    .filter(entry => entry.name.length >= 3)

  const exact = named.filter(entry => entry.name === needle)
  if (exact.length === 1) return { document: exact[0].document, exact: true }
  if (exact.length > 1) return null

  // A title like "bench_dog_plate_1_repaired" still names the design it came
  // from; the longest containing name wins, and a tie is left alone.
  const contained = named
    .filter(entry => needle.includes(entry.name))
    .sort((a, b) => b.name.length - a.name.length)
  if (!contained.length) return null
  if (contained.length > 1 && contained[0].name.length === contained[1].name.length) return null
  return { document: contained[0].document, exact: false }
}

/** Where a design of this kind opens. */
export const designPath = (document: DocumentSummary): string => {
  const path = document.kind === 'shaper' ? '/shaper-designer'
    : document.kind === 'playground' ? '/playground'
      : '/bambu-designer'
  return `${path}?open=${document.id}`
}
