// The shelf an account has, derived from what it bought and what it printed.
//
// Shared by the owned-list route and the reorder check so the two can never
// count a colour differently. Usage is household printer data and so is
// subtracted only for an administrator, exactly as the page shows it only to
// one; anyone else's shelf is what they bought, less what they marked empty.
import type { Owner, Repositories } from '../../lib/db/repositories/contracts.ts'
import { computeFilamentUsage } from '../../lib/contracts/filamentUsage.ts'
import { ledgerOf } from '../../lib/contracts/filamentOrders.ts'
import type { ColorLedger } from '../../lib/contracts/filamentOrders.ts'
import { REPORT_JOB_LIMIT } from '../element/synchronization.ts'

/** Grams printed per catalogue colour, from the recorded history. */
export async function usedGramsOf(repos: Repositories, owner: Owner): Promise<Map<string, number>> {
  const [jobs, mappings] = await Promise.all([
    repos.elementStatistics.listJobs(null, REPORT_JOB_LIMIT),
    repos.filamentUsageMappings.list(owner),
  ])
  return new Map(computeFilamentUsage(jobs, mappings).colors.map(color => [color.key, color.grams]))
}

export async function shelfOf(repos: Repositories, owner: Owner): Promise<Map<string, ColorLedger>> {
  const membership = await repos.memberships.find(owner)
  const [orders, adjustments, used] = await Promise.all([
    repos.filamentOrders.list(owner),
    repos.filamentOrders.listAdjustments(owner),
    membership?.role === 'admin' ? usedGramsOf(repos, owner) : Promise.resolve(new Map<string, number>()),
  ])
  return ledgerOf(orders, used, adjustments)
}
