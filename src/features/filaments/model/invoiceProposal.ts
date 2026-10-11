// An invoice read for review, and whether it can be saved as it stands.
import type { ParsedInvoice } from '../../../../lib/contracts/bambuInvoice.ts'

export interface InvoiceProposal {
  file: string
  /** The PDF itself, kept with the order once it is saved. */
  source?: Blob
  parsed: ParsedInvoice | null
  /** Why it could not be read, when it could not. */
  error: string | null
  /** Already logged under this order number. */
  duplicate: boolean
  include: boolean
}

export const unresolved = (proposal: InvoiceProposal): boolean =>
  Boolean(proposal.parsed?.order.lines.some(line => line.unmatched && !line.key))

export const saveable = (proposal: InvoiceProposal): boolean =>
  Boolean(proposal.parsed) && !proposal.duplicate && !unresolved(proposal)

