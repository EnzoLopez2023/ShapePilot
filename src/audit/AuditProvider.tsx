import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { recordAuditEvent } from './client.ts'
import type { ClientAuditEvent } from './client.ts'

const AuditContext = createContext<(event: ClientAuditEvent) => void>(recordAuditEvent)

/** Records navigation once per real URL change, and exposes an explicit hook. */
export function AuditProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const lastPath = useRef<string | null>(null)

  useEffect(() => {
    if (lastPath.current === location.pathname) return
    lastPath.current = location.pathname
    recordAuditEvent({ category: 'navigation', action: 'view', subject: location.pathname })
  }, [location.pathname])

  const value = useMemo(() => recordAuditEvent, [])
  return <AuditContext.Provider value={value}>{children}</AuditContext.Provider>
}

export const useAudit = (): ((event: ClientAuditEvent) => void) => useContext(AuditContext)
