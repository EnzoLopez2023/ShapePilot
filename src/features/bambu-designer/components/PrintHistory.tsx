// What this design has printed, when the printer's history can say.
//
// The match is by name -- nothing in a cloud record names a design -- so the
// line says "named like this one" rather than claiming provenance.
import { useEffect, useState } from 'react'
import { Link, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import type { DesignPrintHistory } from '../../../services/designDocuments.ts'
import { getDocumentPrints } from '../../../services/designDocuments.ts'

const formatDay = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(iso))

/**
 * Read once per design, not per edit: the history endpoint walks the whole job
 * ledger, and a print that lands while the designer is open will be there the
 * next time the design is opened.
 */
export default function PrintHistory({ documentId }: { documentId: string }) {
  const [history, setHistory] = useState<DesignPrintHistory | null>(null)
  useEffect(() => {
    let cancelled = false
    setHistory(null)
    void getDocumentPrints(documentId)
      .then(found => { if (!cancelled) setHistory(found) })
      .catch(() => { /* no history is shown */ })
    return () => { cancelled = true }
  }, [documentId])

  // Shape-checked rather than trusted: this panel is decoration beside the
  // design, and it must never be the reason the designer stops rendering.
  if (!history || typeof history.prints !== 'number' || history.prints === 0) return null
  if (typeof history.results !== 'object' || history.results === null) return null
  const { prints, results, lastPrintedAt, averageGrams } = history

  return (
    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
      <Link component={RouterLink} to="/admin/el-ement-statistics">
        {prints === 1 ? '1 print' : `${prints} prints`}
      </Link>
      {' '}named like this design
      {results.failed_or_aborted > 0 && <>, {results.failed_or_aborted} failed or aborted</>}
      {lastPrintedAt && <>, last on {formatDay(lastPrintedAt)}</>}
      {averageGrams !== null && <>, about {Math.round(averageGrams)} g each</>}
      .
    </Typography>
  )
}
