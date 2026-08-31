// The build identity of the running instance, for the sidebar footer.
//
// `/version.json` is written once at build time and served unmodified by
// `server/routes/version.ts` -- the same object as `/api/version`, so what the
// sidebar shows can never disagree with what an operator reads from the API.
// It is deliberately unauthenticated: knowing which build is live is not a
// secret, and the stamp has to render before anyone signs in.
import { useEffect, useState } from 'react'

export interface BuildStamp {
  version: string
  /** The release counter a person quotes; `build` is the run that produced it. */
  buildNumber?: string
  build: string
  /** Full commit sha; the UI shows the first seven. */
  commit: string
}

/**
 * `no-store` on the response, and a plain `fetch` rather than `apiRequest`:
 * this needs no token, and a stamp that fails to load must never look like an
 * API error. It simply does not render.
 */
export function useBuildStamp(): BuildStamp | null {
  const [stamp, setStamp] = useState<BuildStamp | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/version.json', { cache: 'no-store', credentials: 'same-origin' })
      .then(response => (response.ok ? response.json() as Promise<BuildStamp> : null))
      .then(result => { if (!cancelled && result) setStamp(result) })
      .catch(() => { /* the stamp is a convenience, never a failure */ })
    return () => { cancelled = true }
  }, [])

  return stamp
}

/** `2.5.3 · build 4 · a1b2c3d`, or the parts that exist. */
export function formatBuildStamp(stamp: BuildStamp): string {
  const parts = [stamp.version]
  // The release counter, not the run identity: `build` is unique per attempt so
  // that an image tag names one build, which makes it unreadable out loud.
  const counter = stamp.buildNumber || stamp.build
  if (counter) parts.push(`build ${counter}`)
  // 'development' is what an unstamped local build carries; a sha is not.
  if (stamp.commit && stamp.commit !== 'development') parts.push(stamp.commit.slice(0, 7))
  else if (stamp.commit) parts.push(stamp.commit)
  return parts.join(' · ')
}
