import { useEffect, useState } from 'react'
import type { DisplayPairing, DisplayStatus } from '../../../lib/contracts/elementDisplay.ts'
import { ApiRequestError, errorMessage } from '../../services/errors.ts'
import { getDisplayStatus, readDisplayPairing, saveDisplayPairing, startDisplayPairing } from './service.ts'
import './element-display.css'

const connectionLabels = {
  unconfigured: 'Unavailable', disabled: 'Monitoring disabled', connecting: 'Connecting',
  connected: 'Connected', offline: 'Printer offline', expired: 'Printer access expired',
  selection_required: 'Approved printer not selected', error: 'Printer connection error',
}
const reading = (value: number | null | undefined, suffix = '') =>
  value == null ? 'Unavailable' : `${Math.round(value)}${suffix}`

export function JobDisplay({ status, error, now }: {
  status: DisplayStatus; error: string | null; now: number
}) {
  const s = status.snapshot
  const stale = Boolean(s && (error || status.freshness !== 'fresh' || now - Date.parse(s.receivedAt) > 180_000))
  const health = error ? 'ShapePilot unreachable'
    : status.connectionState !== 'connected' ? connectionLabels[status.connectionState]
      : stale ? 'Stale report' : !s ? 'No report received' : 'Live report'
  const issue = s?.printError == null ? 'Print error unavailable'
    : s.printError === '0' ? 'No print error reported' : `Print error ${s.printError}`
  const hms = s?.hms == null ? 'HMS unavailable'
    : s.hms.length ? `HMS: ${s.hms.map(item => item.code).join(', ')}` : 'No HMS issues reported'
  return (
    <main className="edge-display" aria-label="Read-only printer job status">
      <header className="edge-header">
        <h1>{status.printerName ?? 'EL-ement printer'}</h1>
        <span className="edge-health" role="status">{health}</span>
      </header>
      <section className="edge-job" aria-label="Current job">
        <p className="edge-state">{s?.state ?? 'Job state unavailable'}{stale ? ' / last known' : ''}</p>
        <h2>{s?.jobName ?? 'Job name unavailable'}</h2>
      </section>
      <section className="edge-progress" aria-label="Job progress">
        <div className="edge-progress-heading">
          <div><span className="edge-label">Progress</span><strong>{reading(s?.progressPercent, '%')}</strong></div>
          <div className="edge-remaining"><span className="edge-label">Remaining</span><strong>{reading(s?.remainingMinutes, ' min')}</strong></div>
        </div>
        {s?.progressPercent != null
          ? <progress aria-label="Reported print progress" max={100} value={s.progressPercent} />
          : <div className="edge-empty-progress" />}
      </section>
      <dl className="edge-metrics">
        <div><dt>Layer / total</dt><dd>{reading(s?.currentLayer)} <span>/ {reading(s?.totalLayers)}</span></dd></div>
        <div><dt>Nozzle <span>actual / target</span></dt><dd>{reading(s?.nozzleActualC, ' \u00b0C')} <span>/ {reading(s?.nozzleTargetC, ' \u00b0C')}</span></dd></div>
        <div><dt>Bed <span>actual / target</span></dt><dd>{reading(s?.bedActualC, ' \u00b0C')} <span>/ {reading(s?.bedTargetC, ' \u00b0C')}</span></dd></div>
      </dl>
      <footer className="edge-footer">
        <p>{issue} <span className="edge-separator">/</span> {hms}</p>
        <p className="edge-updated">{error ?? (s
          ? `${stale ? 'Last known' : 'Reported'} ${new Date(s.receivedAt).toLocaleTimeString()}`
          : 'Waiting for a printer report. Unreported readings are unavailable, not zero.')}</p>
      </footer>
    </main>
  )
}

export default function ElementDisplayPage() {
  const [pairing, setPairing] = useState<DisplayPairing | null>(null)
  const [status, setStatus] = useState<DisplayStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    document.title = 'EL-ement / EDGE'
    try { setPairing(readDisplayPairing()) }
    catch (reason) { setError(`${errorMessage(reason)} Browser storage must be available to remember display access.`) }
    // Contains no status, pairing code or credential; the wrapper checks source and origin.
    window.parent.postMessage({ type: 'shapepilot:element-display:ready' }, '*')
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!pairing) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller = new AbortController()
    const load = async () => {
      clearTimeout(timer)
      controller.abort()
      controller = new AbortController()
      const signal = controller.signal
      let retry = true
      try {
        const value = await getDisplayStatus(pairing.credential, signal)
        if (disposed || signal.aborted) return
        setStatus(value)
        setError(null)
      } catch (reason) {
        if (disposed || signal.aborted) return
        setError(errorMessage(reason))
        if (reason instanceof ApiRequestError && reason.isAuthError) {
          setStatus(null)
          retry = false
        }
      } finally {
        if (!disposed && !signal.aborted && retry) timer = setTimeout(() => void load(), 5000)
      }
    }
    const visible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', visible)
    void load()
    return () => {
      disposed = true
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [pairing])

  const pair = async () => {
    setBusy(true)
    setError(null)
    try {
      // Check storage before minting a credential in an iframe that cannot remember it.
      localStorage.setItem('shapepilot:display-storage-check', '1')
      localStorage.removeItem('shapepilot:display-storage-check')
      const value = await startDisplayPairing()
      saveDisplayPairing(value)
      setPairing(value)
      setStatus(null)
    } catch (reason) {
      setError(`${errorMessage(reason)} If browser storage is blocked, use an approved browser/display configuration; do not bypass IT policy.`)
    } finally { setBusy(false) }
  }
  const reset = () => {
    try {
      saveDisplayPairing(null)
      setPairing(null)
      setStatus(null)
      setError(null)
    } catch (reason) { setError(`Could not reset saved display access: ${errorMessage(reason)}`) }
  }
  if (status?.paired) return <JobDisplay status={status} error={error} now={now} />
  const expired = pairing && now >= Date.parse(status?.expiresAt ?? pairing.expiresAt)
  return (
    <main className="edge-display edge-pairing">
      <h1>EL-ement / EDGE</h1>
      <h2>{pairing ? expired ? 'Pairing expired' : 'Approve this display' : 'Pair your printer display'}</h2>
      <p>Read-only current job. No printer controls, history or spool data.</p>
      {pairing && !expired && <>
        <p className="edge-code" aria-label={`Pairing code ${pairing.code}`}>{pairing.code.slice(0, 5)} {pairing.code.slice(5)}</p>
        <p>On another device, sign in to ShapePilot. Open Admin → EL-ement Statistics → EDGE displays and approve this code.</p>
        <p>Expires at {new Date(status?.expiresAt ?? pairing.expiresAt).toLocaleTimeString()}.</p>
      </>}
      {error && <p role="alert" className="edge-error">{error}</p>}
      <div className="edge-pairing-actions">
        <button disabled={busy} onClick={() => void pair()}>{busy ? 'Starting pairing…' : pairing ? 'Get a new code' : 'Start pairing'}</button>
        {(pairing || error) && <button className="edge-secondary" onClick={reset}>Reset this display</button>}
      </div>
      <p className="edge-updated">Access lasts 90 days and can be revoked in ShapePilot. Reloading iCUE keeps the pairing only if its website storage persists.</p>
    </main>
  )
}
