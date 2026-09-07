// Is there room to write this backup, and will there be room for the next one?
//
// A backup that runs out of disk halfway through is the worst kind of failure:
// it fails, but only after the process has committed to the idea that it has a
// copy. Asking first turns that into a clear refusal before anything is
// written — and, on the deploy path, into a refusal that leaves the schema
// untouched (see preMigrationBackup.ts).
//
// The warning is the other half. A volume that is merely *nearly* full still
// takes today's snapshot, so nothing is blocked; it just says so, while there
// is still time to do something about it and no incident in progress.
import { statSync, statfsSync } from 'node:fs'

/**
 * How many copies of the database exist at the peak of a backup: the snapshot
 * in the work directory, and the copy the store has taken from it. They overlap
 * for as long as the upload runs.
 */
const COPIES_IN_FLIGHT = 2

/** SQLite's copy is not byte-identical to the source; leave room for growth. */
const HEADROOM = 1.25

/**
 * Warn below this much free space however small the database is. A volume with
 * less than this on it is a problem whatever it is being asked to hold — logs,
 * the work directory and SQLite's own journal all share it.
 */
const LOW_SPACE_FLOOR_BYTES = 128 * 1024 * 1024

/** Warn when there is not room for about this many more snapshots. */
const LOW_SPACE_SNAPSHOTS = 10

export interface VolumeSpace {
  path: string
  availableBytes: number
}

/** The filesystem a path lives on, for asking about each volume only once. */
const deviceOf = (path: string): number | null => {
  try {
    return Number(statSync(path).dev)
  } catch {
    return null
  }
}

/**
 * Free space a non-root process can actually use, or null when the filesystem
 * cannot be interrogated.
 *
 * Null is not a failure. A backup must not be refused because `statfs` is
 * unavailable on some filesystem — the write itself remains the real test, and
 * an unanswerable question is not evidence of a problem.
 */
export function availableBytes(path: string): number | null {
  try {
    const stats = statfsSync(path)
    // `bavail`, not `bfree`: the reserved blocks are not ours to use.
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return null
  }
}

const megabytes = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`

export interface SpaceCheck {
  /** Reasons the backup must not be attempted. Empty means go ahead. */
  refusals: string[]
  /** Reasons to say something anyway. Never blocking. */
  warnings: string[]
  /** What was actually measured, for the caller's own reporting. */
  volumes: VolumeSpace[]
}

/**
 * Check every distinct filesystem a backup of `sourceBytes` will touch.
 *
 * Paths that resolve to the same volume are measured once. In production the
 * work directory and the artifact store are both under the same Azure Files
 * mount, so this is usually one measurement — but they are configured
 * separately (`RECOVERY_WORK_ROOT`, `BACKUP_ROOT`) and nothing stops them being
 * split, so both are asked.
 */
export function checkSpaceFor(
  paths: readonly string[],
  sourceBytes: number,
  probe: (path: string) => number | null = availableBytes,
): SpaceCheck {
  const required = Math.ceil(sourceBytes * COPIES_IN_FLIGHT * HEADROOM)
  const comfortable = Math.max(LOW_SPACE_FLOOR_BYTES, sourceBytes * LOW_SPACE_SNAPSHOTS)

  const refusals: string[] = []
  const warnings: string[] = []
  const volumes: VolumeSpace[] = []
  const seen = new Set<number>()

  for (const path of paths) {
    const available = probe(path)
    if (available === null) continue
    // One measurement per volume, not per configured path. Keyed on the device
    // id rather than the free byte count, which two separate volumes could
    // coincidentally share.
    const device = deviceOf(path)
    if (device !== null) {
      if (seen.has(device)) continue
      seen.add(device)
    }
    volumes.push({ path, availableBytes: available })

    if (available < required) {
      refusals.push(
        `${path} has ${megabytes(available)} free and this backup needs about `
        + `${megabytes(required)} (two copies of a ${megabytes(sourceBytes)} database while the `
        + 'upload runs)',
      )
    } else if (available < comfortable) {
      warnings.push(
        `${path} has ${megabytes(available)} free — room for roughly `
        + `${Math.floor(available / Math.max(1, sourceBytes))} more snapshots of this database. `
        + 'Old artifacts can be removed from the store by hand once they are no longer the '
        + 'newest pre-migration copy.',
      )
    }
  }

  return { refusals, warnings, volumes }
}
