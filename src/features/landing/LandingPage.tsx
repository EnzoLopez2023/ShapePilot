/*
 * ShapePilot — signed-out landing page.
 *
 * IMPECCABLE DIRECTION CONTRACT (full text in index.html, first child of <body>).
 * Mode: Persuade. Pinned to the nintek app-family "fabrication drawing" world.
 * THESIS ....... a landing page that IS a fabrication drawing: graph-paper ground,
 *               registration marks, dimension lines, a title block, FIG. plates;
 *               it refuses the SaaS hero and invents no metrics or logos.
 * OWN-WORLD .... warm-paper blueprint, one blue structural accent, one brass note
 *               on the primary action only. Archivo display / Martian Mono labels.
 * STORY ........ a lone maker learns in one viewport that ShapePilot lays out
 *               Systainer-tray pockets to the mm, checks both machines, exports a
 *               file with nothing uploaded — then signs in with Microsoft.
 * FIRST VIEWPORT eyebrow + huge H1 "Know it fits / before you cut." + subhead +
 *               brass "Sign in with Microsoft" + ghost link; right = a floating
 *               dimensioned tray blueprint with a selected pocket mid-rotate.
 * SIGNATURE .... blueprint parallax at 3 depths + the hero pocket sweeping 0->15deg
 *               with the Angle° readout counting up; sections plot in on a wipe.
 * FINISH ....... unreviewed and undocumented is unfinished; this build ends with
 *               the finish review, the verdict, and DESIGN.md.
 */
import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { useThemeMode } from '../../theme/ThemeModeProvider.tsx'
import './landing.css'
import { ArrowRight, ArrowDown, Sun, Moon, Cube } from './icons.tsx'

const APP_ICON = '/apple-touch-icon.png'
import {
  TrayBlueprint, PaletteSheet, TransformSheet, AdvisorySheet,
  ExportSheet, IsoTraySheet, DashboardSheet,
} from './mocks.tsx'

const prefersReduced = (): boolean => {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

export interface LandingPageProps {
  onSignIn: () => void
  authConfigured: boolean
}

function SignInButton({
  onSignIn, authConfigured, ghost = false, sm = false, label = 'Sign in with Microsoft',
}: LandingPageProps & { ghost?: boolean; sm?: boolean; label?: string }) {
  return (
    <button
      type="button"
      className={`sp-btn${ghost ? ' sp-btn--ghost' : ''}${sm ? ' sp-btn--sm' : ''}`}
      aria-disabled={!authConfigured || undefined}
      onClick={authConfigured ? onSignIn : (e: MouseEvent) => e.preventDefault()}
    >
      {label}
      <ArrowRight />
    </button>
  )
}

export function LandingPage({ onSignIn, authConfigured }: LandingPageProps) {
  const { mode, preference, setPreference } = useThemeMode()
  const rootRef = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  const [angle, setAngle] = useState(0)

  const reduced = prefersReduced()

  /* ---- reveals + nav border + 3-depth parallax ----
   * Reveals go through an IntersectionObserver AND a plain scroll/timer sweep,
   * so a section is never left invisible if one path is throttled (e.g. an
   * offscreen render pane pausing rAF). Parallax is rAF-only; it is decorative
   * and a paused pane simply shows it at rest. */
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const revealEls = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))
    const layerEls = Array.from(root.querySelectorAll<HTMLElement>('[data-parallax]'))
    const show = (el: Element) => el.classList.add('is-visible')

    if (reduced) {
      revealEls.forEach(show)
      setStuck(window.scrollY > 8)
      return
    }

    const sweep = () => {
      const h = window.innerHeight
      setStuck(window.scrollY > 8)
      for (const el of revealEls) {
        if (!el.classList.contains('is-visible') && el.getBoundingClientRect().top < h * 0.9) show(el)
      }
    }

    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) { show(e.target); io.unobserve(e.target) } }),
      { threshold: 0, rootMargin: '0px 0px -6% 0px' },
    )
    revealEls.forEach(el => io.observe(el))

    let raf = 0
    const parallax = () => {
      raf = 0
      const y = window.scrollY
      for (const el of layerEls) {
        const f = parseFloat(el.dataset.parallax ?? '0')
        el.style.transform = `translate3d(0, ${(y * f).toFixed(2)}px, 0)`
      }
    }
    const onScroll = () => {
      sweep()
      if (!raf) raf = requestAnimationFrame(parallax)
    }
    sweep()
    const t1 = window.setTimeout(sweep, 250)
    const t2 = window.setTimeout(sweep, 1200)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      io.disconnect()
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [reduced])

  /* ---- hero Angle° count-up, in step with the CSS pocket sweep ---- */
  useEffect(() => {
    if (reduced) { setAngle(15); return }
    let raf = 0
    const start = performance.now() + 500 // matches sp-sweep delay
    const dur = 1000
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / dur))
      // ease-out cubic to echo --sp-ease
      const e = 1 - Math.pow(1 - t, 3)
      setAngle(+(e * 15).toFixed(1))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reduced])

  const nextTheme = mode === 'dark' ? 'light' : 'dark'
  const toggleTheme = () => setPreference(nextTheme)
  const auth = { onSignIn, authConfigured }

  return (
    <div className="sp-landing" data-theme={mode} ref={rootRef}>
      <div className="sp-grid" data-parallax="0.04" aria-hidden="true" />

      {/* ------------------------------------------------------------ nav */}
      <header className="sp-nav" data-stuck={stuck}>
        <a
          className="sp-brand"
          href="#sp-main"
          onClick={e => { e.preventDefault(); rootRef.current?.querySelector('#sp-main')?.scrollIntoView() }}
          style={{ textDecoration: 'none' }}
        >
          <img className="sp-brand__mark" src={APP_ICON} alt="" width={30} height={30} />
          <span className="sp-brand__name">ShapePilot</span>
          <span className="sp-brand__rule" />
          <span className="sp-brand__tag">Fabrication workbench</span>
        </a>
        <div className="sp-nav__right">
          <button
            type="button"
            className="sp-icon-btn"
            onClick={toggleTheme}
            aria-label={`Switch to ${nextTheme} theme`}
            title={`Switch to ${nextTheme} theme${preference === 'system' ? '' : ''}`}
          >
            {mode === 'dark' ? <Sun /> : <Moon />}
          </button>
          <SignInButton {...auth} ghost sm label="Sign in" />
        </div>
      </header>

      <main id="sp-main" className="sp-content">
        {/* ---------------------------------------------------------- hero */}
        <section className="sp-hero" aria-labelledby="sp-h1">
          <span className="sp-cmark tl" /><span className="sp-cmark tr" />
          <span className="sp-cmark bl" /><span className="sp-cmark br" />

          <div className="sp-hero__copy">
            <p className="sp-eyebrow">A fabrication workbench for Systainer trays</p>
            <h1 className="sp-h1" id="sp-h1">
              Know it fits
              <span className="acc">before you cut.</span>
            </h1>
            <p className="sp-lede">
              ShapePilot lays out keycap-tray pockets to the millimetre, checks them against the
              printer and the CNC you actually own, and hands you a file the machine accepts.
              The geometry never leaves your browser.
            </p>
            <div className="sp-hero__ctas">
              <SignInButton {...auth} />
              <a
                className="sp-btn sp-btn--ghost"
                href="#fig-01"
                onClick={e => { e.preventDefault(); rootRef.current?.querySelector('#fig-01')?.scrollIntoView({ block: 'start' }) }}
              >
                See the workbench
                <ArrowDown />
              </a>
            </div>
            <p className="sp-micro">
              {authConfigured
                ? 'Microsoft Entra sign-in · every tray scoped to your account · nothing shared'
                : 'Sign-in isn’t configured for this build — set VITE_ENTRA_* to enable it.'}
            </p>
          </div>

          <div className="sp-hero__stage">
            <div data-parallax="-0.05">
              <TrayBlueprint sweep={!reduced} />
            </div>
            <div className="sp-hero__status" data-parallax="-0.08" aria-hidden="true">
              <span className="sp-chip sp-chip--ok"><Cube /> Watertight · 24,318 tri</span>
            </div>
            <div className="sp-hero__angle" data-parallax="-0.11" aria-hidden="true">
              ∠ {angle.toFixed(1)}°
            </div>
            <div className="sp-annot sp-hero__annot" data-parallax="-0.13" aria-hidden="true">
              checked against your Bambu&nbsp;X2D + Shaper&nbsp;Origin
            </div>
          </div>
        </section>

        {/* --------------------------------------------------- spec rule (static) */}
        <div className="sp-specrule" aria-hidden="true">
          <span><b>STL</b> · <b>3MF</b> · <b>SVG</b> · <b>DXF</b></span>
          <span>1u pitch 19.05 mm</span>
          <span>min wall 1.8 mm</span>
          <span>tool Ø3.175 mm</span>
          <span>mm · y-up</span>
        </div>

        {/* ----------------------------------------------------------- stats */}
        <section className="sp-stats" aria-label="What ShapePilot ships" data-reveal>
          {[
            ['49', '', 'pocket sizes in the library — 1u to 13u in 0.25u steps, plus ISO Enter'],
            ['4', '', 'export formats — STL and 3MF for the printer, SVG and DXF for the CNC'],
            ['2', '', 'machines checked on every edit — Bambu X2D and Shaper Origin'],
            ['0', '', 'bytes of your geometry sent to a server — parameters only'],
          ].map(([n, s, l]) => (
            <div className="sp-stat" key={l}>
              <div className="sp-stat__n">{n}{s && <small>{s}</small>}</div>
              <div className="sp-stat__l">{l}</div>
            </div>
          ))}
        </section>

        {/* --------------------------------------------------------- FIG. 01 */}
        <section className="sp-figrow" id="fig-01" aria-labelledby="fig-01-h">
          <div className="sp-figrow__copy" data-reveal>
            <div className="sp-figrow__head">
              <span className="sp-fig">Fig. 01</span><span className="sp-rule" />
            </div>
            <h2 className="sp-h2" id="fig-01-h">Lay the pockets in.</h2>
            <p className="sp-body">
              Drag a size off the palette and drop it into a real Systainer profile. Snap to the
              1u key pitch or to any half-millimetre, line pockets up against the tray edge, and
              keep a rim buffer clear of the wall-thickness minimum.
            </p>
            <ul className="sp-figrow__list">
              <li>Plain or notched SYS3 S 76 out of the box; custom profiles load and export.</li>
              <li>Every ANSI width, from 1u alphas to the 6.25u spacebar.</li>
              <li>The canvas never hides behind a tab — you always see the work.</li>
            </ul>
          </div>
          <div className="sp-figrow__media"><PaletteSheet /></div>
        </section>

        {/* --------------------------------------------------------- FIG. 02 */}
        <section className="sp-figrow sp-figrow--flip" aria-labelledby="fig-02-h">
          <div className="sp-figrow__copy" data-reveal>
            <div className="sp-figrow__head">
              <span className="sp-fig">Fig. 02</span><span className="sp-rule" />
            </div>
            <h2 className="sp-h2" id="fig-02-h">Turn it, mirror it, tilt it.</h2>
            <p className="sp-body">
              Rotate a pocket to any angle about its un-rotated footprint centre, so its position
              stays put while it spins. Shift-drag snaps to 15°. Mirror and flip the asymmetric
              shapes. One history entry per gesture — undo is always one step.
            </p>
            <ul className="sp-figrow__list">
              <li>Corner handles on the canvas, or a precise Angle° field in the panel.</li>
              <li>The 90° Tilt toggle and free rotation share one real number.</li>
              <li>ISO Enter is a true L-shaped footprint, not a rectangle stand-in.</li>
            </ul>
          </div>
          <div className="sp-figrow__media"><TransformSheet /></div>
        </section>

        {/* --------------------------------------------------------- FIG. 03 */}
        <section className="sp-figrow" aria-labelledby="fig-03-h">
          <div className="sp-figrow__copy" data-reveal>
            <div className="sp-figrow__head">
              <span className="sp-fig">Fig. 03</span><span className="sp-rule" />
            </div>
            <h2 className="sp-h2" id="fig-03-h">Check both machines.</h2>
            <p className="sp-body">
              A tray that prints clean can still be invalid on the CNC. ShapePilot runs the
              manufacturability checks per machine and tells you which one is unhappy and why —
              wall thickness against the bit, watertightness, floor depth. It never silently
              corrects your geometry.
            </p>
            <ul className="sp-figrow__list">
              <li>Advisory, not blocking — you decide what ships.</li>
              <li>A leaky mesh is an error, not a warning a slicer will “repair”.</li>
              <li>Wall-thickness minimum tracks the tool diameter you set.</li>
            </ul>
          </div>
          <div className="sp-figrow__media"><AdvisorySheet /></div>
        </section>

        {/* --------------------------------------------------------- FIG. 04 */}
        <section className="sp-figrow sp-figrow--flip" aria-labelledby="fig-04-h">
          <div className="sp-figrow__copy" data-reveal>
            <div className="sp-figrow__head">
              <span className="sp-fig">Fig. 04</span><span className="sp-rule" />
            </div>
            <h2 className="sp-h2" id="fig-04-h">Export the file the machine takes.</h2>
            <p className="sp-body">
              Pick the target and take the format: STL or 3MF for the Bambu, a Shaper-ready SVG or
              a 2D DXF for the Origin. Every byte is generated in the browser from the design
              parameters — reproducible, and never uploaded.
            </p>
            <ul className="sp-figrow__list">
              <li>The server stores parameters; generated bytes are rebuilt from them.</li>
              <li>Non-manifold output stops the export — it is an error by design.</li>
              <li>Imperial is a display layer; the model is always millimetres.</li>
            </ul>
          </div>
          <div className="sp-figrow__media"><ExportSheet /></div>
        </section>

        {/* --------------------------------------------------------- FIG. 05 */}
        <section className="sp-figrow" aria-labelledby="fig-05-h">
          <div className="sp-figrow__copy" data-reveal>
            <div className="sp-figrow__head">
              <span className="sp-fig">Fig. 05</span><span className="sp-rule" />
            </div>
            <h2 className="sp-h2" id="fig-05-h">See it solid.</h2>
            <p className="sp-body">
              Flip from layout to a real 3D solid — floor, walls, and every pocket cut in. Orbit
              it, check the depths, confirm the rim before you commit a sheet of stock. The 3D
              viewer loads on demand, so it is never in the first paint.
            </p>
            <ul className="sp-figrow__list">
              <li>The same watertight mesh that the STL and 3MF are written from.</li>
              <li>Triangle count is announced for assistive tech.</li>
            </ul>
          </div>
          <div className="sp-figrow__media"><IsoTraySheet /></div>
        </section>

        {/* ------------------------------------------------ what you sign in to */}
        <section className="sp-figrow sp-figrow--flip" aria-labelledby="hub-h">
          <div className="sp-figrow__copy" data-reveal>
            <div className="sp-figrow__head">
              <span className="sp-fig">What you sign in to</span><span className="sp-rule" />
            </div>
            <h2 className="sp-h2" id="hub-h">Your trays, where you left them.</h2>
            <p className="sp-body">
              One Microsoft account. Your designs are saved server-side as parameters —
              small, reproducible, private to your account, and there when you come back.
              No collaboration surface, no sharing, no second owner.
            </p>
            <ul className="sp-figrow__list">
              <li>Entra sign-in; the app requests a token for its own API, nothing more.</li>
              <li>Open, clone, or delete from one dialog. Delete is a real confirm.</li>
            </ul>
          </div>
          <div className="sp-figrow__media"><DashboardSheet /></div>
        </section>

        {/* --------------------------------------------------------- close CTA */}
        <section className="sp-close" aria-labelledby="close-h" data-reveal>
          <span className="sp-cmark tl" /><span className="sp-cmark tr" />
          <span className="sp-cmark bl" /><span className="sp-cmark br" />
          <p className="sp-eyebrow">mm · y-up · your geometry stays in the browser</p>
          <h2 className="sp-h2" id="close-h" style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)' }}>
            Open the workbench.
          </h2>
          <p className="sp-lede">
            One sign-in gets you the layout canvas, both machine checks, and every export format.
            Built for the maker with a Bambu on the shelf and a Shaper on the bench.
          </p>
          <SignInButton {...auth} />
        </section>
      </main>

      <footer className="sp-footer">
        <p className="tag">
          <img src={APP_ICON} alt="" width={22} height={22} />
          ShapePilot · Approachable 2D/3D design, viewing, editing, and fabrication.
        </p>
        <p className="stamp">Wave 1 · Keycap Tray Designer</p>
      </footer>
    </div>
  )
}

export default LandingPage
