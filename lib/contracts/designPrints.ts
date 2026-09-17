// What a saved design has actually printed.
//
// Nothing in the printer's cloud record names a design: the only thread back is
// the job title, the file the slicer was given. ShapePilot names an export
// after the design and Bambu Studio adds a plate number and an extension, so a
// design and a job are matched on a normalised form of both -- letters and
// digits only. It is a likely match, never a proven one, and the wording
// wherever it is shown has to say so.
import type { ElementJob, ElementJobResult } from './elementStatistics.ts'

/** Letters and digits, lower case; everything else is separator noise. */
export const normaliseTitle = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** The slicer's own decorations around the name it was given. */
export const stripTitleDecorations = (title: string): string => title
  .replace(/\.(3mf|stl|obj|gcode|step|stp)$/i, '')
  .replace(/[_\s-]*plate[_\s-]*\d+$/i, '')
  .replace(/[_\s-]*\(\d+\)$/, '')
  .trim()

/** A name short enough to match half the ledger is not a name to match on. */
export const MIN_MATCH_LENGTH = 3

export const titleMatchesDesign = (title: string | null, designName: string): boolean => {
  const name = normaliseTitle(designName)
  if (name.length < MIN_MATCH_LENGTH || title === null) return false
  const needle = normaliseTitle(stripTitleDecorations(title))
  return needle.length >= MIN_MATCH_LENGTH && needle.includes(name)
}

export interface DesignPrintHistory {
  /** Jobs whose title names this design. */
  prints: number
  results: Record<ElementJobResult, number>
  /** ISO-8601 start of the most recent one, or null. */
  lastPrintedAt: string | null
  /** Mean slice estimate over the jobs that reported one, and how many did. */
  averageGrams: number | null
  gramsKnown: number
}

export function designPrintHistory(
  designName: string, jobs: readonly ElementJob[],
): DesignPrintHistory {
  const history: DesignPrintHistory = {
    prints: 0,
    results: { completed: 0, failed_or_aborted: 0, active: 0, unknown: 0 },
    lastPrintedAt: null,
    averageGrams: null,
    gramsKnown: 0,
  }
  let grams = 0
  for (const job of jobs) {
    if (!titleMatchesDesign(job.title, designName)) continue
    history.prints++
    history.results[job.result] = (history.results[job.result] ?? 0) + 1
    if (job.startedAt !== null
      && (history.lastPrintedAt === null || job.startedAt > history.lastPrintedAt)) {
      history.lastPrintedAt = job.startedAt
    }
    // Estimates only, and only where one was reported: an average over a
    // silent job would be an average over a number nobody has.
    if (typeof job.estimatedWeightGrams === 'number' && Number.isFinite(job.estimatedWeightGrams)) {
      grams += job.estimatedWeightGrams
      history.gramsKnown++
    }
  }
  if (history.gramsKnown > 0) history.averageGrams = grams / history.gramsKnown
  return history
}
