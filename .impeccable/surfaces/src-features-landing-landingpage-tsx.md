---
version: 1
slug: "src-features-landing-landingpage-tsx"
primary_target: "src/features/landing/LandingPage.tsx"
related_targets: ["src/features/landing/mocks.tsx","src/features/landing/landing.css","src/auth/AuthGuard.tsx"]
---

# Surface — Signed-out landing

**Scope.** `src/features/landing/` (`LandingPage.tsx`, `mocks.tsx`, `icons.tsx`,
`landing.css`). Rendered by `AuthGuard`'s `UnauthenticatedTemplate`, so it is the
whole experience for anyone not signed in. Signed-in users never see it; they go
straight to `/keycap-tray`.

**Visitor mode.** Persuade. First-time visitor with a Bambu X2D printer and a
Shaper Origin CNC. Job: understand in one viewport that ShapePilot lays out
Systainer-tray pockets to the millimetre, checks manufacturability per machine,
and exports a machine-ready file with nothing uploaded — then sign in with
Microsoft. Action: the "Sign in with Microsoft" buttons call the same
`instance.loginRedirect` the app has always used.

**Direction — pinned, not rolled.** The user pinned the nintek app-family landing
system (cairn / workshop / tabloom / lantern .nintek.com): a full-bleed blueprint
grid with corner registration marks, a giant tight headline with one accent line,
`FIG.0X` feature plates each carrying a floating UI mock with hand annotations, a
stat quad, a "what you sign in to" preview, a `Sign in with Microsoft` pill, and a
one-line footer. ShapePilot's take pushes the family into a literal **fabrication
drawing** (dimension lines, tolerances, a title block) on a **warm-paper** ground
(`#f1efe9`, tying to the app canvas) with a **machined-brass** primary action —
in the family, its own identity. `concept-seed` was not run: narrow, pinned
request.

**Memorable moment.** The hero blueprint's selected pocket sweeps 0°→15° once on
load while a `∠ 15.0°` tag counts up beside it — the per-pocket transform,
demonstrated before any copy is read. Blueprint parallax runs at three depths;
sections plot in on a left-to-right clip wipe. All of it is gated on
`prefers-reduced-motion` (content fully visible, no transforms).

**Palette / type (landing only — the workbench is untouched).**
Light: ground `#f1efe9`, sheet `#fff`, one structural accent = ShapePilot blue
`#1f5c8b`, one warm note = brass `#8a4f1c` on the primary action only, blue-tinted
grid at 13/22% alpha. Full graphite-blueprint dark variant (`#141518` ground,
cyan grid, brass `#e0a15c`). Display face **Archivo** (700/800), micro-labels
**Martian Mono** (drawing-office caps), body on the app's system stack. Both
webfonts are loaded in `index.html` and used *only* here.

**Accepted deviations from the app's DESIGN.md prohibitions** — scoped to this
Persuade surface, core to the pinned world, and matching all four siblings:
- Decorative grid-line background — this surface *is* a blueprint; the product
  literally emits SVG/DXF drawings. (The static detector flags `codex-grid-background`;
  its own text exempts blueprint/measurement surfaces.)
- Mono eyebrow + `FIG.0X` labels above headings — structural wayfinding in the
  family, not ornament.
- `backdrop-filter` blur on the stuck nav — chrome only, consistent with the
  app's own "glass is for chrome" rule.

**Integration notes.**
- `LandingPage({ onSignIn, authConfigured })`. When `authConfigured` is false the
  sign-in buttons are inert (`aria-disabled`) and the hero shows the
  `VITE_ENTRA_*` hint instead of the reassurance line.
- Dev preview: `VITE_AUTH_MODE=development` (in `.env.local`) bypasses the gate,
  so the landing is only reachable with the gate on. `.env.landingpreview.local`
  + `.claude/launch.json` ("landing-preview", `vite --mode landingpreview`) force
  the gate on without real Entra config.

**Unresolved.**
- Real product screenshots would replace the authored SVG/HTML mocks in
  `mocks.tsx` (tray blueprint, palette, transform, per-machine advisory, export,
  3D iso, dashboard). Tray names and counts in the mocks are illustrative.
- No `/privacy` or `/terms` routes exist; the footer deliberately carries none.
