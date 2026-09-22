// A reel of filament seen from the side, as Bambu Handy draws one.
//
// Three reads in one picture: the colour, the form it is sold in (a spool has
// its grey flanges; a refill is the bare coil, capped with its own face), and
// how much is left -- the coil's height shrinks toward the hub with the share
// remaining. An unreported amount is drawn full and faded rather than guessed.
//
// The coil is shaded top-to-bottom so it reads as a cylinder, and edged with a
// faint ring: Jade White is #FFFFFF on a white surface and several darks are
// near-black on the dark ground, so without the ring those reels are not there.
import { useId } from 'react'
import type { FilamentVariant } from '../../../../lib/contracts/bambuFilaments.ts'

/** The reel's own plastics: literal colours, because this is a picture of an object. */
const FLANGE_FRONT = '#B7BCC1'
const FLANGE_FRONT_EDGE = '#9EA4AA'
const FLANGE_BACK = '#8D9399'
const HUB = '#4A5056'
const HUB_HOLE = '#2A2E33'

export interface SpoolArtProps {
  hexes: readonly string[]
  /** `refill` drops the flanges. Defaults to `spool`. */
  variant?: FilamentVariant
  /** Share left, 0..1. `null` is "not reported": full height, faded. Defaults to full. */
  fill?: number | null
  /** Dims the whole reel, for a discontinued colour. */
  faded?: boolean
  /** Rendered height in px; width follows the 64 × 72 drawing. */
  size?: number
  /** Print the tray name on the coil, as Handy does in its AMS card. */
  label?: string
}

export function SpoolArt({
  hexes, variant = 'spool', fill = 1, faded, size = 64, label,
}: SpoolArtProps) {
  const id = useId().replace(/:/g, '')
  const known = fill !== null
  const share = known ? Math.max(0, Math.min(1, fill)) : 1
  // Between the hub (a spent spool) and just inside the flange rim (a full one).
  const half = 9 + 17 * share
  const top = 36 - half
  const bottom = 36 + half
  const rx = 3 + 5 * share
  const paint = hexes.length > 1 ? `url(#${id}-dual)` : hexes[0]
  const coil = `M20 ${top} H44 A${rx} ${half} 0 0 1 44 ${bottom} H20 A${rx} ${half} 0 0 1 20 ${top} Z`
  const spool = variant === 'spool'

  return (
    <svg
      viewBox="0 0 64 72"
      width={(size * 64) / 72}
      height={size}
      aria-hidden
      style={{ display: 'block', flexShrink: 0, opacity: faded ? 0.5 : 1, overflow: 'visible' }}
    >
      <defs>
        {hexes.length > 1 && (
          // Dual colour: a 135° split of its two hexes, as the swatch draws it.
          <linearGradient id={`${id}-dual`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="50%" stopColor={hexes[0]} />
            <stop offset="50%" stopColor={hexes[1]} />
          </linearGradient>
        )}
        <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.34" />
          <stop offset="0.28" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="0.62" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.3" />
        </linearGradient>
        <linearGradient id={`${id}-flange`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#D4D8DC" />
          <stop offset="1" stopColor={FLANGE_FRONT} />
        </linearGradient>
      </defs>

      {spool && <ellipse cx="20" cy="36" rx="9" ry="31" fill={FLANGE_BACK} />}

      <g opacity={known ? 1 : 0.5}>
        <path d={coil} fill={paint} />
        <path d={coil} fill={`url(#${id}-shade)`} />
        <path d={coil} fill="none" stroke="rgba(0,0,0,0.22)" strokeWidth="0.75" />
        {/* The coil's own face, where a refill has no flange to hide it. */}
        {!spool && (
          <>
            <ellipse cx="44" cy="36" rx={rx} ry={half} fill={paint} />
            <ellipse cx="44" cy="36" rx={rx} ry={half} fill="#fff" fillOpacity="0.16" />
            <ellipse cx="44" cy="36" rx={rx} ry={half} fill="none" stroke="rgba(0,0,0,0.22)" strokeWidth="0.75" />
            <ellipse cx="44" cy="36" rx="2.6" ry="8" fill={HUB_HOLE} opacity="0.55" />
          </>
        )}
      </g>

      {spool && (
        <>
          <ellipse cx="44" cy="36" rx="10" ry="32" fill={`url(#${id}-flange)`} stroke={FLANGE_FRONT_EDGE} strokeWidth="0.75" />
          <ellipse cx="45" cy="36" rx="3.6" ry="10" fill={HUB} />
          <ellipse cx="45.4" cy="36" rx="2" ry="6" fill={HUB_HOLE} />
        </>
      )}

      {label && (
        <g>
          <rect x="22" y="29" width="20" height="14" rx="4" fill="rgba(20,23,26,0.62)" />
          <text
            x="32" y="39.2" textAnchor="middle" fill="#fff"
            style={{ font: '650 9.5px Inter, system-ui, sans-serif', letterSpacing: '0.02em' }}
          >
            {label}
          </text>
        </g>
      )}
    </svg>
  )
}
