// The last AMS report, as the trays a part can print from.
import { useEffect, useState } from 'react'
import { getFilamentUsage } from '../filaments/service.ts'
import type { AmsTray } from './amsTrays.ts'
import { amsTrays } from './amsTrays.ts'

export interface AmsTrayState {
  /** Null while loading, or when this account cannot see the printer. */
  trays: AmsTray[] | null
  receivedAt: string | null
}

/**
 * The last AMS report, read once per designer. Unavailable -- no connection,
 * not an administrator, the request failed -- is an ordinary state: the field
 * still offers every tray by number, it just cannot say what is loaded.
 */
export function useAmsTrays(): AmsTrayState {
  const [state, setState] = useState<AmsTrayState>({ trays: null, receivedAt: null })
  useEffect(() => {
    let cancelled = false
    void getFilamentUsage()
      .then(report => {
        if (cancelled || !report?.ams) return
        setState({ trays: amsTrays(report.ams), receivedAt: report.ams.receivedAt })
      })
      .catch(() => { /* unavailable; the field falls back to bare numbers */ })
    return () => { cancelled = true }
  }, [])
  return state
}

