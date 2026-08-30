/*
 * Authored mockups of ShapePilot's real workbench, drawn as inline SVG / styled
 * markup so they stay crisp and theme-aware. Every value shown is real product
 * vocabulary (Systainer SYS3 S 76, Bambu X2D, Shaper Origin, STL/3MF/SVG/DXF,
 * 1.8 mm min wall, Ø3.175 mm bit, mm / y-up). The tray layouts are illustrative.
 */
import { CheckCircle, WarnTriangle, Grid, Sliders, Shield } from './icons.tsx'

const MONO = { fontFamily: 'var(--sp-mono)' } as const

/* ------------------------------------------------------------------ pockets */

interface Pk { x: number; y: number; w: number; h: number }

const U = 19 // mm pitch used for the illustrative layouts
const cell = (u: number) => u * U - 1

/** A compact keyboard-ish cluster that fits inside the 248x156 plain insert. */
function layout(ox: number, oy: number): Pk[] {
  const r: Pk[] = []
  const row = (ry: number, widths: number[]) => {
    let cx = ox
    for (const wu of widths) {
      r.push({ x: cx, y: oy + ry * U, w: cell(wu), h: cell(1) })
      cx += wu * U
    }
  }
  row(0, [1, 1, 1, 1, 1, 1, 1, 1])
  row(1, [1.5, 1, 1, 1, 1, 1, 1])
  row(2, [1.75, 1, 1, 1, 1, 1])
  row(3, [2.25, 1, 1, 1, 1, 1])
  row(4, [1.25, 1.25, 6.25])
  return r
}

function Pocket({ p, variant }: { p: Pk; variant?: 'sel' | 'iso' }) {
  const sel = variant === 'sel'
  return (
    <rect
      x={p.x} y={p.y} width={p.w} height={p.h} rx={2}
      fill={sel ? 'color-mix(in srgb, var(--sp-accent) 14%, var(--sp-sheet))' : 'var(--sp-sheet-sunk)'}
      stroke={sel ? 'var(--sp-accent)' : 'var(--sp-hairline)'}
      strokeWidth={sel ? 1.1 : 0.7}
    />
  )
}

function DimH({ x1, x2, y, label }: { x1: number; x2: number; y: number; label: string }) {
  return (
    <g stroke="var(--sp-accent-ink)" strokeWidth={0.6} fill="var(--sp-accent-ink)">
      <line x1={x1} y1={y - 5} x2={x1} y2={y + 3} />
      <line x1={x2} y1={y - 5} x2={x2} y2={y + 3} />
      <line x1={x1} y1={y} x2={x2} y2={y} />
      <path d={`M${x1 + 4},${y - 2} L${x1},${y} L${x1 + 4},${y + 2}Z`} />
      <path d={`M${x2 - 4},${y - 2} L${x2},${y} L${x2 - 4},${y + 2}Z`} />
      <text
        x={(x1 + x2) / 2} y={y - 3} textAnchor="middle"
        style={MONO} fontSize={7} stroke="none"
      >
        {label}
      </text>
    </g>
  )
}

function DimV({ y1, y2, x, label }: { y1: number; y2: number; x: number; label: string }) {
  return (
    <g stroke="var(--sp-accent-ink)" strokeWidth={0.6} fill="var(--sp-accent-ink)">
      <line x1={x - 3} y1={y1} x2={x + 5} y2={y1} />
      <line x1={x - 3} y1={y2} x2={x + 5} y2={y2} />
      <line x1={x} y1={y1} x2={x} y2={y2} />
      <path d={`M${x - 2},${y1 + 4} L${x},${y1} L${x + 2},${y1 + 4}Z`} />
      <path d={`M${x - 2},${y2 - 4} L${x},${y2} L${x + 2},${y2 - 4}Z`} />
      <text
        x={x + 4} y={(y1 + y2) / 2} style={MONO} fontSize={7} stroke="none"
        transform={`rotate(90 ${x + 4} ${(y1 + y2) / 2})`} textAnchor="middle"
      >
        {label}
      </text>
    </g>
  )
}

/** The hero blueprint: dimensioned Systainer insert with a selected, rotated pocket. */
export function TrayBlueprint({ sweep = false }: { sweep?: boolean }) {
  const TX = 26, TY = 12, TW = 248, TH = 156
  const pockets = layout(TX + 20, TY + 14)
  const selIndex = 16 // a 1u pocket in the third row
  const sel = pockets[selIndex]
  const scx = sel.x + sel.w / 2
  const scy = sel.y + sel.h / 2

  return (
    <svg
      viewBox="0 0 300 200" role="img"
      aria-label="ShapePilot layout view: a Systainer SYS3 S 76 insert, 248 by 156 millimetres, with keycap pockets laid out and one pocket selected and rotated 15 degrees."
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      {/* tray outline + rim buffer */}
      <rect
        x={TX} y={TY} width={TW} height={TH} rx={6}
        fill="var(--sp-sheet)" stroke="var(--sp-ink-soft)" strokeWidth={1}
      />
      <rect
        x={TX + 5} y={TY + 5} width={TW - 10} height={TH - 10} rx={4}
        fill="none" stroke="var(--sp-hairline)" strokeWidth={0.6} strokeDasharray="3 2.5"
      />

      {pockets.map((p, i) => (i === selIndex ? null : <Pocket key={i} p={p} />))}

      {/* selected pocket + rotate handles, sweeps 0 -> 15deg once */}
      <g className={sweep ? 'sp-sweep' : undefined} style={!sweep ? { transform: 'rotate(15deg)', transformBox: 'fill-box', transformOrigin: 'center' } : undefined}>
        <Pocket p={sel} variant="sel" />
        {[[sel.x, sel.y], [sel.x + sel.w, sel.y], [sel.x + sel.w, sel.y + sel.h], [sel.x, sel.y + sel.h]].map(([hx, hy], i) => (
          <circle key={i} cx={hx} cy={hy} r={1.9} fill="var(--sp-sheet)" stroke="var(--sp-accent)" strokeWidth={0.9} />
        ))}
      </g>
      {/* pivot marker (un-rotated footprint centre) + leader toward the annotation */}
      <circle cx={scx} cy={scy} r={1} fill="var(--sp-accent)" />
      <line x1={scx} y1={scy} x2={scx + 66} y2={scy + 40} stroke="var(--sp-brass)" strokeWidth={0.6} strokeDasharray="2 2" />
      <circle cx={scx + 66} cy={scy + 40} r={1} fill="var(--sp-brass)" />

      {/* title block, lower-right inside the tray */}
      <g style={MONO} fontSize={5} fill="var(--sp-muted)">
        <rect x={TX + TW - 84} y={TY + TH - 34} width={78} height={28} fill="var(--sp-sheet)" stroke="var(--sp-hairline)" strokeWidth={0.6} />
        <line x1={TX + TW - 84} y1={TY + TH - 24} x2={TX + TW - 6} y2={TY + TH - 24} stroke="var(--sp-hairline)" strokeWidth={0.5} />
        <line x1={TX + TW - 84} y1={TY + TH - 15} x2={TX + TW - 6} y2={TY + TH - 15} stroke="var(--sp-hairline)" strokeWidth={0.5} />
        <text x={TX + TW - 80} y={TY + TH - 27}>SYS3 S 76 · PLAIN</text>
        <text x={TX + TW - 80} y={TY + TH - 18}>248.0 × 156.0 mm</text>
        <text x={TX + TW - 80} y={TY + TH - 9}>UNITS mm · Y-UP</text>
      </g>

      <DimH x1={TX} x2={TX + TW} y={TY + TH + 12} label="248.0" />
      <DimV y1={TY} y2={TY + TH} x={TX - 12} label="156.0" />
    </svg>
  )
}

/* ----------------------------------------------------------- FIG.01 palette */

const PAL = [
  ['1u', 'Alphas'],
  ['1.25u', 'Ctrl · Win · Alt'],
  ['1.5u', 'Tab'],
  ['1.75u', 'Caps Lock'],
  ['2u', 'Backspace'],
  ['2.25u', 'ANSI Enter'],
  ['2.75u', 'R-Shift'],
  ['6.25u', 'Spacebar'],
  ['ISO', 'ISO Enter'],
]

export function PaletteSheet() {
  return (
    <div className="sp-sheet" data-reveal>
      <div className="sp-sheet__bar">
        <span className="sp-sheet__dot" /><span className="sp-sheet__dot" /><span className="sp-sheet__dot" />
        <span className="sp-sheet__title">Layout · pocket palette</span>
      </div>
      <div className="sp-sheet__body sp-palgrid">
        <div className="sp-palchips">
          {PAL.map(([u, t]) => (
            <span className="sp-palchip" key={u}><b>{u}</b> {t}</span>
          ))}
        </div>
        <div style={{ border: '1px solid var(--sp-hairline)', borderRadius: 10, overflow: 'hidden', background: 'var(--sp-sheet)' }}>
          <svg viewBox="24 8 208 150" style={{ width: '100%', height: 'auto', display: 'block' }} aria-hidden="true">
            <rect x={28} y={12} width={200} height={140} rx={5} fill="var(--sp-sheet)" stroke="var(--sp-ink-soft)" strokeWidth={1} />
            <rect x={33} y={17} width={190} height={130} rx={3} fill="none" stroke="var(--sp-hairline)" strokeWidth={0.5} strokeDasharray="3 2.5" />
            {layout(44, 30).map((p, i) => (
              <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={2}
                fill={i === 16 ? 'color-mix(in srgb, var(--sp-accent) 16%, var(--sp-sheet))' : 'var(--sp-sheet-sunk)'}
                stroke={i === 16 ? 'var(--sp-accent)' : 'var(--sp-hairline)'} strokeWidth={i === 16 ? 1 : 0.7} />
            ))}
            <text x={128} y={146} textAnchor="middle" style={MONO} fontSize={5.6} fill="var(--sp-muted)">
              SNAP 1u PITCH · 19.05 mm · GRID 5 mm
            </text>
          </svg>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------- FIG.02 rotate */

export function TransformSheet() {
  return (
    <div className="sp-sheet" data-reveal>
      <div className="sp-sheet__bar">
        <span className="sp-sheet__dot" /><span className="sp-sheet__dot" /><span className="sp-sheet__dot" />
        <span className="sp-sheet__title">Layout · ISO Enter selected</span>
      </div>
      <div className="sp-sheet__body sp-tfgrid">
        <svg viewBox="0 0 200 200" style={{ width: '100%', height: 'auto', display: 'block' }} aria-hidden="true">
          <rect x={8} y={8} width={184} height={184} rx={6} fill="var(--sp-sheet)" stroke="var(--sp-ink-soft)" strokeWidth={1} />
          {/* ISO-enter footprint (tall L), rotated 12deg about its footprint centre */}
          <g style={{ transform: 'rotate(12deg)', transformBox: 'fill-box', transformOrigin: 'center' }}>
            <path
              d="M78 66 h44 v68 h-30 v-30 h-14 Z"
              fill="color-mix(in srgb, var(--sp-accent) 14%, var(--sp-sheet))"
              stroke="var(--sp-accent)" strokeWidth={1.4}
            />
            {[[78, 66], [122, 66], [122, 134], [78, 134]].map(([hx, hy], i) => (
              <circle key={i} cx={hx} cy={hy} r={3.4} fill="var(--sp-sheet)" stroke="var(--sp-accent)" strokeWidth={1.3} />
            ))}
          </g>
          <circle cx={100} cy={100} r={2} fill="var(--sp-accent)" />
          <text x={100} y={180} textAnchor="middle" style={MONO} fontSize={7} fill="var(--sp-muted)">
            pivot = un-rotated footprint centre
          </text>
        </svg>
        <div>
          <div className="sp-props__row"><span className="k">Angle°</span><span className="v sp-props__val">12.0</span></div>
          <div className="sp-props__row"><span className="k">Tilt 90°</span><span className="v">☐</span></div>
          <div className="sp-props__row"><span className="k">Mirror X</span><span className="v">☑</span></div>
          <div className="sp-props__row"><span className="k">Flip Y</span><span className="v">☐</span></div>
          <div className="sp-props__row"><span className="k">Shift-drag</span><span className="v">snap 15°</span></div>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------- FIG.03 checks */

export function AdvisorySheet() {
  return (
    <div className="sp-sheet" data-reveal>
      <div className="sp-sheet__bar">
        <span className="sp-sheet__dot" /><span className="sp-sheet__dot" /><span className="sp-sheet__dot" />
        <span className="sp-sheet__title">Manufacturability · per machine</span>
      </div>
      <div className="sp-sheet__body sp-adv">
        <div className="sp-adv__item">
          <CheckCircle className="sp-adv__icon" style={{ color: 'var(--sp-ok)' }} />
          <div>
            <div className="sp-adv__machine">Bambu X2D · 3D print</div>
            <div className="sp-adv__msg">
              Watertight mesh, 24,318 triangles. Floor 2.4 mm, walls clear of the 1.8 mm minimum.
              Files are generated in the browser; nothing is uploaded.
            </div>
          </div>
        </div>
        <div className="sp-adv__item">
          <WarnTriangle className="sp-adv__icon" style={{ color: 'var(--sp-warn)' }} />
          <div>
            <div className="sp-adv__machine">Shaper Origin · CNC</div>
            <div className="sp-adv__msg">
              Wall between P07 and P12 is 1.4 mm — under the 1.8 mm minimum for the Ø3.175 mm bit.
              Advisory only; nothing is changed for you.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------- FIG.04 export */

export function ExportSheet() {
  return (
    <div className="sp-sheet" data-reveal>
      <div className="sp-sheet__bar">
        <span className="sp-sheet__dot" /><span className="sp-sheet__dot" /><span className="sp-sheet__dot" />
        <span className="sp-sheet__title">Export</span>
      </div>
      <div className="sp-sheet__body">
        <div className="sp-exp__targets" role="presentation">
          <button type="button" data-on="true" tabIndex={-1}>Bambu X2D</button>
          <button type="button" data-on="false" tabIndex={-1}>Shaper Origin</button>
        </div>
        <div className="sp-exp__formats">
          <div className="sp-exp__fmt"><span className="n">STL</span><span className="d">binary mesh · printer</span></div>
          <div className="sp-exp__fmt"><span className="n">3MF</span><span className="d">mesh + metadata · printer</span></div>
          <div className="sp-exp__fmt"><span className="n">SVG</span><span className="d">Shaper vectors · CNC</span></div>
          <div className="sp-exp__fmt"><span className="n">DXF</span><span className="d">2D profile · CNC</span></div>
        </div>
        <p className="sp-micro" style={{ marginTop: 12 }}>
          ◇ Generated from parameters, in your browser. Non-manifold output is an error, not a warning.
        </p>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------- FIG.05 3D */

export function IsoTraySheet() {
  return (
    <div className="sp-sheet" data-reveal>
      <div className="sp-sheet__bar">
        <span className="sp-sheet__dot" /><span className="sp-sheet__dot" /><span className="sp-sheet__dot" />
        <span className="sp-sheet__title">3D preview · 24,318 triangles</span>
      </div>
      <div className="sp-sheet__body">
        <svg viewBox="0 0 320 210" style={{ width: '100%', height: 'auto', display: 'block' }}
          role="img" aria-label="Isometric solid preview of the tray with pockets cut into the floor.">
          <defs>
            <linearGradient id="sp-iso-top" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--sp-sheet)" />
              <stop offset="1" stopColor="var(--sp-sheet-sunk)" />
            </linearGradient>
          </defs>
          {/* tray body: top face + two sides in iso */}
          <polygon points="40,96 165,32 290,96 165,160" fill="url(#sp-iso-top)" stroke="var(--sp-ink-soft)" strokeWidth={1} />
          <polygon points="40,96 165,160 165,188 40,124" fill="var(--sp-sheet-sunk)" stroke="var(--sp-ink-soft)" strokeWidth={1} />
          <polygon points="290,96 165,160 165,188 290,124" fill="var(--sp-ground-2)" stroke="var(--sp-ink-soft)" strokeWidth={1} />
          {/* a few recessed pockets on the top face */}
          {[
            [120, 78], [150, 66], [180, 78], [138, 92], [168, 104], [198, 92],
          ].map(([px, py], i) => (
            <polygon key={i}
              points={`${px},${py} ${px + 20},${py - 10} ${px + 34},${py - 3} ${px + 14},${py + 7}`}
              fill="var(--sp-ground-2)" stroke="var(--sp-hairline)" strokeWidth={0.7} />
          ))}
          <text x={165} y={202} textAnchor="middle" style={MONO} fontSize={8} fill="var(--sp-muted)">
            LAYOUT ↔ 3D · drag to orbit · three.js loads on demand
          </text>
        </svg>
      </div>
    </div>
  )
}

/* -------------------------------------------------- "what you sign in to" */

const TRAYS = [
  ['Split ortho — 4×6', '48 pockets · updated 2 days ago'],
  ['60% HHKB layout', '61 pockets · updated last week'],
  ['Numpad + macro cluster', '21 pockets · updated Aug 12'],
  ['Systainer drawer — bits', '9 pockets · updated Aug 3'],
]

export function DashboardSheet() {
  return (
    <div className="sp-sheet" data-reveal>
      <div className="sp-sheet__bar">
        <span className="sp-sheet__dot" /><span className="sp-sheet__dot" /><span className="sp-sheet__dot" />
        <span className="sp-sheet__title">shapepilot · signed in as Enzo</span>
      </div>
      <div className="sp-dash">
        <div className="sp-dash__rail">
          <div className="sp-dash__nav" data-on="true"><Grid /> Keycap tray</div>
          <div className="sp-dash__nav"><Sliders /> Settings</div>
          <div className="sp-dash__nav"><Shield /> Admin</div>
        </div>
        <div className="sp-dash__main">
          <p className="sp-micro" style={{ marginBottom: 2 }}>SAVED TRAYS · SCOPED TO YOUR ACCOUNT</p>
          {TRAYS.map(([nm, mt]) => (
            <div className="sp-dash__row" key={nm}>
              <span className="nm">{nm}</span>
              <span className="mt">{mt}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
