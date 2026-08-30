/* Small inline icons for the landing page — stroke-based, currentColor, 24-grid.
 * Kept local so the marketing surface doesn't inherit the MUI icon set. */
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

const base = (p: P) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...p,
})

export const ArrowRight = (p: P) => (
  <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)

export const ArrowDown = (p: P) => (
  <svg {...base(p)}><path d="M12 5v14M6 13l6 6 6-6" /></svg>
)

export const Sun = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)

export const Moon = (p: P) => (
  <svg {...base(p)}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
)

export const Check = (p: P) => (
  <svg {...base(p)}><path d="M20 6 9 17l-5-5" /></svg>
)

export const CheckCircle = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></svg>
)

export const WarnTriangle = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3.5 22 20H2L12 3.5Z" />
    <path d="M12 10v4.5M12 17.5h.01" />
  </svg>
)

export const Grid = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
  </svg>
)

export const Sliders = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M18 18h2" />
    <circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="15" cy="18" r="2" />
  </svg>
)

export const Shield = (p: P) => (
  <svg {...base(p)}><path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" /></svg>
)

export const Cube = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 2.7 20.5 7v10L12 21.3 3.5 17V7L12 2.7Z" />
    <path d="M3.5 7 12 11.5 20.5 7M12 11.5V21.3" />
  </svg>
)

/* ShapePilot brand mark — a tray footprint with a routed pocket + centre pivot. */
export const Mark = (p: P) => (
  <svg viewBox="0 0 32 32" fill="none" {...p}>
    <rect x="3.5" y="6.5" width="25" height="19" rx="3.5" stroke="currentColor" strokeWidth="1.8" />
    <rect x="8" y="11" width="10" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
    <path d="M20.5 14.5h4M22.5 12.5v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="13" cy="14.5" r="1.3" fill="currentColor" />
  </svg>
)
