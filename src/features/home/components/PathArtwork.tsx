// What each designer actually makes, drawn.
//
// Not icons. A keycap tray card shows a real Systainer outline with real
// pockets in it -- the same `profileToMulti` and `pocketRing` the designer and
// the exporter use -- so the picture cannot drift from the product. The other
// three are authored in the same hand: one stroke weight, one radius, drawn as
// a fabrication drawing rather than an illustration.
//
// Each is a static drawing with one moving part, and the movement is the thing
// that designer does: a pocket drops into the tray, a cut path offsets from its
// line, a hole subtracts from a solid, a prompt resolves into geometry. Motion
// is declared in CSS so `prefers-reduced-motion` -- already global in
// MuiCssBaseline -- stops it without a second code path.
import { Box } from '@mui/material'
import { pocketRing } from '../../keycap-tray/geometry/shapes.ts'
import { PYTHON_SIZING } from '../../keycap-tray/geometry/shapes.ts'
import { profileToMulti } from '../../keycap-tray/model/presets.ts'
import { multiBBox } from '../../../geometry/vec.ts'
import type { MultiPolygon, Ring } from '../../../geometry/vec.ts'

const ringPath = (ring: Ring): string =>
  `${ring.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')}Z`

const multiPath = (mp: MultiPolygon): string =>
  mp.flatMap(polygon => polygon.map(ringPath)).join(' ')

/** Shared frame: y-up model flipped into SVG's y-down, one stroke weight. */
function Drawing(
  { viewBox, flip, children }:
  { viewBox: string; flip?: [number, number]; children: React.ReactNode },
) {
  return (
    <Box
      component="svg"
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      sx={{
        display: 'block',
        width: '100%',
        height: '100%',
        overflow: 'visible',
        '& [data-part]': { vectorEffect: 'non-scaling-stroke' },
      }}
    >
      {flip
        ? <g transform={`translate(0 ${flip[0] + flip[1]}) scale(1 -1)`}>{children}</g>
        : children}
    </Box>
  )
}

/** A real Systainer tray with a real row of pockets falling into it. */
export function KeycapArtwork() {
  const outline = profileToMulti({ kind: 'preset', id: 'systainer-s76-plain' })
  const b = multiBBox(outline)
  const rows = [
    [1, 1, 1, 1.25, 1.75],
    [2.25, 1, 1, 6.25],
  ]
  let index = 0
  const pockets = rows.flatMap((row, r) => {
    let x = b.minX + 14
    return row.map(units => {
      const pocket = { units, x, y: b.minY + 34 + r * 26 }
      x += units * 19.05 + 4
      return { d: multiPath([pocketRing(pocket, PYTHON_SIZING)]), order: index++ }
    })
  })

  return (
    <Drawing
      viewBox={`${b.minX - 4} ${b.minY - 4} ${b.maxX - b.minX + 8} ${b.maxY - b.minY + 8}`}
      flip={[b.minY, b.maxY]}
    >
      <path
        data-part d={multiPath(outline)}
        fill="currentColor" fillOpacity={0.05}
        stroke="currentColor" strokeOpacity={0.5} strokeWidth={1.25}
      />
      {pockets.map(pocket => (
        <path
          key={pocket.order}
          data-part
          className="drop"
          style={{ animationDelay: `${pocket.order * 55}ms` }}
          d={pocket.d}
          fill="currentColor" fillOpacity={0.16}
          stroke="currentColor" strokeOpacity={0.62} strokeWidth={1.25}
        />
      ))}
    </Drawing>
  )
}

/**
 * A 45-degree hatch trimmed to the pocket rectangle (56,38)-(94,66).
 *
 * Each line runs down-right from the rectangle's top edge or left edge to
 * whichever edge it leaves by, so the fill is clipped by construction. Computed
 * once, at module scope: it never changes.
 */
const HATCH: [number, number, number, number][] = (() => {
  const [left, top, right, bottom] = [56, 38, 94, 66]
  const lines: [number, number, number, number][] = []
  for (let offset = -28; offset <= 38; offset += 7) {
    // The line y = x - (left + offset) + top, clipped to the box.
    const x1 = Math.max(left, left + offset)
    const y1 = top + (x1 - (left + offset))
    const x2 = Math.min(right, left + offset + (bottom - top))
    const y2 = top + (x2 - (left + offset))
    if (x2 > x1 && y1 < bottom) lines.push([x1, y1, x2, Math.min(bottom, y2)])
  }
  return lines
})()

/**
 * A part, and the cut that makes it.
 *
 * The Origin's whole idea is that a line means something different depending on
 * which side of it the bit runs: outside for the part, inside for an opening,
 * on the line for a scribe. Drawn at rest rather than only on hover, because a
 * card that reads as two grey rectangles until touched has said nothing.
 */
export function ShaperArtwork() {
  const part = 'M46 22 H120 A10 10 0 0 1 130 32 V72 A10 10 0 0 1 120 82 H46 A10 10 0 0 1 36 72 V32 A10 10 0 0 1 46 22 Z'
  const outside = 'M44 14 H122 A18 18 0 0 1 140 32 V72 A18 18 0 0 1 122 90 H44 A18 18 0 0 1 26 72 V32 A18 18 0 0 1 44 14 Z'
  return (
    <Drawing viewBox="0 0 176 104">
      {/* The tool path, outside the part: what an outside cut actually is. */}
      <path
        data-part className="offset offset-out" d={outside}
        fill="none" stroke="currentColor" strokeOpacity={0.38}
        strokeWidth={1} strokeDasharray="5 4"
      />
      <path
        data-part d={part}
        fill="currentColor" fillOpacity={0.07}
        stroke="currentColor" strokeOpacity={0.6} strokeWidth={1.25}
      />

      {/* A pocket, hatched the way a drawing hatches removed material. Drawn as
          real lines rather than a <pattern>: a pattern needs a document-unique
          id, and this artwork can appear twice on the page -- in a card and in
          the hero -- which would make one of them reference the other's. */}
      <rect
        data-part x={56} y={38} width={38} height={28} rx={4}
        fill="currentColor" fillOpacity={0.05}
        stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.25}
      />
      {HATCH.map(([x1, y1, x2, y2], index) => (
        <line
          key={index} data-part
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke="currentColor" strokeOpacity={0.32} strokeWidth={1}
        />
      ))}
      {/* An on-line cut: a scribe that removes nothing. */}
      <path
        data-part className="offset offset-in" d="M104 38 V66"
        stroke="currentColor" strokeOpacity={0.5} strokeWidth={1.25} fill="none"
      />

      {/* The measurement a drawing carries: this is a part, not a picture. */}
      <g stroke="currentColor" strokeOpacity={0.3} strokeWidth={1} data-part>
        <path d="M26 98 H140" />
        <path d="M26 94 V102" />
        <path d="M140 94 V102" />
      </g>

      <circle
        data-part className="bit" cx={0} cy={0} r={4.5}
        fill="none" stroke="currentColor" strokeOpacity={0.9} strokeWidth={1.5}
      />
    </Drawing>
  )
}

/** A solid, a hole, and the boolean between them. */
export function BambuArtwork() {
  return (
    <Drawing viewBox="0 0 176 104">
      {/* An extruded plate drawn in the flat-with-edges way the viewport draws. */}
      <path data-part d="M42 40 L88 18 L134 40 L134 72 L88 94 L42 72 Z"
        fill="currentColor" fillOpacity={0.1}
        stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.25} />
      <path data-part d="M42 40 L88 62 L134 40" fill="none"
        stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.25} />
      <path data-part d="M88 62 V94" fill="none"
        stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.25} />
      {/* The hole: drawn as a subtraction, sinking into the face on hover. */}
      <g className="hole">
        <ellipse data-part cx={88} cy={44} rx={17} ry={9}
          fill="var(--sp-surface)" stroke="currentColor"
          strokeOpacity={0.7} strokeWidth={1.25} />
        <path data-part d="M71 44 V56 A17 9 0 0 0 105 56 V44" fill="none"
          stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.25} />
      </g>
    </Drawing>
  )
}

/** A prompt resolving into geometry: the line becomes the part. */
export function PlaygroundArtwork() {
  return (
    <Drawing viewBox="0 0 176 104">
      {/* Three lines of "prompt", then the solid they resolve into. */}
      {[0, 1, 2].map(row => (
        <rect
          key={row} data-part className="prompt"
          style={{ animationDelay: `${row * 120}ms` }}
          x={30} y={22 + row * 11} width={row === 2 ? 62 : 116} height={4} rx={2}
          fill="currentColor" fillOpacity={0.22}
        />
      ))}
      <g className="resolved">
        <path data-part d="M46 62 L88 44 L130 62 L130 84 L88 102 L46 84 Z"
          fill="currentColor" fillOpacity={0.12}
          stroke="currentColor" strokeOpacity={0.6} strokeWidth={1.25} />
        <path data-part d="M46 62 L88 80 L130 62" fill="none"
          stroke="currentColor" strokeOpacity={0.42} strokeWidth={1.25} />
        <path data-part d="M88 80 V102" fill="none"
          stroke="currentColor" strokeOpacity={0.42} strokeWidth={1.25} />
      </g>
    </Drawing>
  )
}
