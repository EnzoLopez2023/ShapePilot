# DESIGN.md — ShapePilot

The design system as it actually shipped. Recorded from the built artifact, not
from what was planned. If prose here disagrees with `src/theme/theme.ts`, the
code wins.

## Mode

Operate. This is a fabrication workbench: a signed-in maker opens ShapePilot,
lays out pockets in a tray, checks whether it can be printed or cut on the
machines they own, and exports a file the machine will accept. Consistency and
scanability outrank expression. Nothing here is a landing page.

## World

Restrained workbench content wrapped in native-iOS chrome. Working surfaces
(properties panel, canvas, dialogs) keep a single hairline border, one squircle
radius, one accent for the active tool and the primary action, and type that
stays legible next to a technical drawing — but every one now floats on the
`SHADOW` lift so surfaces read as sitting above the canvas, not inlaid into it.

The app chrome — the left sidebar and the mobile top bar — is frosted glass:
`rgba(255,255,255,0.4)` fill (dark: `rgba(28,28,30,0.55)`), a matching hairline
in `rgba(255,255,255,0.35)` (dark `0.12`), and `backdrop-filter: blur(20px)
saturate(180%)` with its `-webkit-` pair. The sidebar is a detached rounded
panel (`14px`, `12px` margin, the `SHADOW` lift). On `md` and up it collapses
to a `76px` icon rail via a toggle in its header; the choice persists in
`localStorage` under `shapepilot:nav-collapsed` and rows show a right-placed
tooltip while collapsed. Below `md` the same nav is a temporary drawer. Sidebar
rows fade to an elevated `rgba(255,255,255,0.15)` on hover over
`background 0.2s ease-in-out`; the active row sits on `…,0.55`. Tokens live in
`GLASS` in `src/theme/theme.ts` and are consumed **only** by the shell
(`src/app/AppShell.tsx`) — no working surface reads them.

This reverses the earlier "no translucency, no blur, no gradient" rule, which
had itself dropped the inherited Hearth glass aesthetic
(`src/KeycapTray/components/glass.ts` at Hearth commit
`f0b05fc1dbf53e8aa26c215d8e858894a2793871`). The reversal is scoped to chrome
on purpose: glass frames the work, it does not sit under it.

## Tokens

Single source: `src/theme/theme.ts`. Consumed through the MUI theme, not
duplicated as CSS variables. The theme is rebuilt when the mode flips
(`ThemeModeProvider.tsx`), so a light-only or dark-only value is a bug.

**Light is the default.** With nothing stored, `ThemeModeProvider` and the
server `DEFAULT_PREFERENCES` both resolve to `light`; `system` and `dark` apply
only once the user chooses them (in Settings or via the appearance store).

### Palette — light

| Token           | Value     | Role                                         |
|-----------------|-----------|----------------------------------------------|
| `canvas`        | `#F2F1EE` | Page background behind the app shell         |
| `surface`       | `#FFFFFF` | Paper: header, palette, inspector, dialogs   |
| `surfaceSunken` | `#E9E7E2` | Recessed strip inside a surface              |
| `border`        | `#C4C0B8` | The one hairline. Also `divider`             |
| `borderStrong`  | `#8D887E` | Outlined button edge; heavier separators     |
| `text`          | `#1B1A18` | Body and headings                            |
| `textMuted`     | `#565149` | Secondary and helper copy                    |
| `accent`        | `#1F5C8B` | Active tool state and the primary action     |
| `accentText`    | `#FFFFFF` | Foreground on `accent`                       |
| `danger`        | `#9B2C2C` | Destructive confirm; error alert             |
| `warning`       | `#8A5A00` | Advisory manufacturability                   |
| `success`       | `#1F6B45` | Save confirmation                            |

### Palette — dark

| Token           | Value     | Role                                         |
|-----------------|-----------|----------------------------------------------|
| `canvas`        | `#16171A` | Page background behind the app shell         |
| `surface`       | `#1E2024` | Paper: header, palette, inspector, dialogs   |
| `surfaceSunken` | `#121316` | Recessed strip inside a surface              |
| `border`        | `#3A3E45` | The one hairline. Also `divider`             |
| `borderStrong`  | `#5E646E` | Outlined button edge; heavier separators     |
| `text`          | `#EDEDEC` | Body and headings                            |
| `textMuted`     | `#A9AEB6` | Secondary and helper copy                    |
| `accent`        | `#79B6E4` | Active tool state and the primary action     |
| `accentText`    | `#10161C` | Foreground on `accent`                       |
| `danger`        | `#F09393` | Destructive confirm; error alert             |
| `warning`       | `#E3B457` | Advisory manufacturability                   |
| `success`       | `#7FCBA1` | Save confirmation                            |

### Structural tokens

| Token    | Value | Rule                                                        |
|----------|-------|-------------------------------------------------------------|
| `RADIUS`   | `14` | iOS squircle. Paper, Button, ToggleButton, OutlinedInput, Chip, Tooltip, Alert, Dialog, ListItemButton — every rounded corner in the app, including the sidebar panel and its rows. |
| `BORDER`   | `1`  | Every visible edge. Paper, AppBar, Alert, outlined controls all use the same 1px hairline. |
| `SHADOW`   | see `theme.ts` | Two-layer card lift (ambient pool + contact shadow), per mode. Applied to every `MuiPaper` root and to the sidebar. |
| `EASE_IOS` | `cubic-bezier(0.32, 0.72, 0, 1)` | Apple-style easing for chrome transitions (sidebar width, drawer, menus, hover fades). |
| `GLASS`    | see `theme.ts` | Frosted-glass fill/hover/active/border/backdrop, per mode. Consumed only by `AppShell`. |

Tooltip surface uses a separate ink independent of `surface`
(`#2C2A26` light, `#33383F` dark) so it reads as an overlay, not a panel.

### Typography

Family: `Inter`, then `system-ui, -apple-system, "Segoe UI", Roboto,
"Helvetica Neue", Arial, sans-serif`. Base size 14 px.

| Role     | Size        | Weight | Letter-spacing | Line-height |
|----------|-------------|--------|----------------|-------------|
| `h1`     | `1.5rem`    | 600    | `-0.01em`      | default     |
| `h2`     | `1.125rem`  | 600    | `-0.005em`     | default     |
| `h3`     | `0.9375rem` | 600    | —              | default     |
| `body1`  | `0.875rem`  | 400    | —              | `1.55`      |
| `body2`  | `0.8125rem` | 400    | —              | `1.5`       |
| `button` | inherit     | 550    | —              | non-uppercase |

There is no display face. There is no `body3`, `caption`, or "eyebrow" style;
the ramp is deliberately short so a technical drawing has the visual weight and
the chrome around it does not compete.

### Spacing

MUI 8 px scale, referenced by the standard multiplier only. The shipped code
uses `0.5`, `0.75`, `1`, `1.25`, `1.5`, `2`, `2.5`, `3` — nothing bespoke.

Concrete rhythms actually used:

- Header row: `px: 1.5`, `py: 1` (12/8).
- App shell main padding: `px: {xs: 1.5, md: 2.5}`, `py: {xs: 1.5, md: 2}`.
- Panel body padding: `p: 1.5` (12).
- Stack between panels or between form rows: `spacing={1.5}` (12).
- Row of related controls: `spacing={1}` or `spacing={0.5}` (8 or 4).

### Focus

Global rule, applied through `MuiCssBaseline`:

```css
:focus-visible { outline: 2px solid <accent>; outline-offset: 2px; }
```

Measured on the shipped build: `2px solid rgb(31,92,139)` light,
`2px solid rgb(121,182,228)` dark. This ring is never removed and never
overridden per component. If a component appears not to show it, the fault is
in the component, not the rule.

### Motion

Two-layer rule.

1. Global: `@media (prefers-reduced-motion: reduce)` inside `MuiCssBaseline`
   sets animation and transition durations to `0.01ms` and disables smooth
   scroll everywhere. This runs before any component code.
2. User-controlled: `Settings → Motion` lets the user pick `system`, `reduce`,
   or `no-preference` regardless of the OS.

There is no motion design system beyond MUI's own defaults for menus, dialogs,
and snackbars. There are no bespoke keyframes and no scroll-driven effects.

### Selection colour

Text selection uses `accent` as background with `accentText` as foreground.
Set on `::selection` in `MuiCssBaseline` and not overridden.

## Layout system

App shell (`src/app/AppShell.tsx`):

- A skip link to `#main` — off-screen until focused, then anchored at 8/8.
- A header bar: `Paper` with a bottom hairline, a wordmark, and a `<nav>` of
  real `NavLink` routes. There is no global view toggle.
- A `<main id="main">` that fills the remainder in a flex column.

Designer surface — the keycap tray
(`src/features/keycap-tray/KeycapTrayPage.tsx`) and, since Wave 2, the Shaper
and Bambu designers through the shared
`src/components/designer/DesignerLayout.tsx`:

```
grid-template-rows:    auto minmax(0, 1fr)
grid-template-columns: 1fr                                          @ xs
                       220px minmax(0, 1fr)                         @ md
                       220px minmax(0, 1fr) 312px                   @ lg
grid gap:              1.5   (12 px)
```

Row 1 is the toolbar `Paper`. Row 2 is the workbench grid.

At `xs`, the columns collapse to one and the rows re-order so the canvas is
first with `minmax(360px, 55vh)`, palette second, inspector third. The canvas
is never hidden behind a tab; the operator always sees their work.

Panels are `MUI Paper`: a `1px` border in `divider` colour plus the `SHADOW`
lift so the panel floats above the canvas. `elevation` stays `0` — the shadow
is the single `boxShadow` from the token, not MUI's elevation scale — and
`backgroundImage: none` is enforced so a Paper never picks up MUI's default
overlay gradient in dark mode.

The AI Imagination Playground (`src/features/playground/PlaygroundPage.tsx`)
deliberately does **not** use the three-column workbench. There the conversation
is the tool rather than an accessory to a canvas, so it takes a column of its
own:

```
grid-template-columns: 1fr                        @ xs
                       340px minmax(0, 1fr)       @ md
```

At `xs` the viewport still re-orders first, on the same rule as the workbench.

## Designer conventions (Wave 2)

Behaviours the three designers share, so moving between them teaches nothing new:

- **A gesture is one undo step.** The canvas and the 3D gizmo both mutate the
  document once, on release — never per frame. An applied AI turn is likewise a
  single `replace` call.
- **Solid or hole is a property, grouping is the verb.** A hole outside a group
  is inert. This is Tinkercad's model and users arrive already knowing it.
- **The assistant proposes.** Its result is previewed with a diff of the parts it
  would add, change or remove, next to Apply and Discard. Nothing it returns
  reaches the document unasked.
- **Manufacturability is advisory.** Checks read the machine profile and report;
  nothing is silently corrected, per `PRODUCT.md`.
- **Direct manipulation, numeric confirmation.** Drag on the canvas, then read
  and adjust the exact value in the inspector. `LengthField` speaks millimetres
  or fractional inches; the document is always millimetres.
- **Solids render flat, with their edges drawn.** Each facet is one tone and
  feature edges are outlined, which is how CAD reads and how a fabricable part
  should look — not a product render. Concretely: `flatShading`, no
  `computeVertexNormals` (the kernel returns welded geometry, so averaging
  normals smooths across every sharp edge and shades a flat face like a curved
  one), an `EdgesGeometry` outline above 20 degrees so a tessellated cylinder
  does not draw as a wireframe, polygon offset so those lines do not stipple,
  and lighting tuned for face separation rather than drama -- under flat shading
  the normal is constant across a triangle, so no key light can produce a
  gradient within a face, and contrast is what makes a flat plate readable.
  Selection recolours the outline, which reads better than a wash of emissive.
  All of it lives in `src/components/viewport3d/solidRender.ts`, shared by the
  keycap tray preview and the designer viewport so a part cannot change
  appearance by being looked at on a different page.

## Per-pocket transform (keycap tray)

`pocketRing` (→ `isoEnterRing` for `iso-enter`) is the single function that turns
a pocket into a polygon; the canvas, the SVG/DXF exports, the mesh and the
validators all consume it. Generation order for any shape:

```
base ring, local coords, origin (0,0), bbox w0×h0   (w0,h0 = UN-rotated extents)
 → reflect in footprint box   (mirrorX: x→w0-x ; flipY: y→h0-y ; re-reverse iff exactly one)
 → rotate by rotationDeg about (w0/2, h0/2)          (proper rotation, winding kept)
 → quantise to the 1e-4 mm grid   (only when a transform was applied)
 → translate by (x, y)
```

- **Pivot is the un-rotated footprint centre.** So `(x + w0/2, y + h0/2)` is
  invariant under rotate/mirror/flip. `pocketExtent` returns that un-rotated box
  — the label anchor, alignment-guide targets, drag snap and drop centring all
  key off its centre and need no rotation awareness. `pocketAABB` gives the true
  rotated bounds for edge-based callers (Center X/Y).
- **`rotationDeg` is one real number, any angle in `[0, 360)`.** The 90° "Tilt"
  toggle just writes `0` / `90`; the canvas corner-handles and the panel's
  `Angle°` field write anything. A pocket at 45° shows Tilt unchecked, and
  toggling Tilt replaces the angle.
- **Canvas rotate handles** (`RotateHandles` in `TrayCanvas.tsx`): four circles
  at the rotated footprint corners of the sole selected pocket, radius `view.w/200`
  with a `view.w/90` invisible grab target. Angle is `atan2` of the cursor about
  the pivot in model space; the live preview is an SVG `rotate(delta cx cy)` on
  the `<path>` only (the committed angle is already baked into `d`), so the label
  and handles stay upright. Shift snaps to 15°. One history entry on pointer-up.
- **Mirror / flip are `mirrorX` / `flipY` booleans**, generic across shapes but
  only visible on an asymmetric one (rounded rects are symmetric). The panel
  buttons/switches are gated to `shape === 'iso-enter'`.
- **Known limitation:** many *freely-rotated* pockets packed densely can trip
  the T-junction pass (`tjunction.ts`), surfacing as a spurious `non-manifold`
  print error. A single rotated pocket at any angle is watertight (swept in
  `mesh.test.ts`). Hardening the T-junction epsilons for non-axis-aligned
  geometry is follow-up work.

## Named rules

- **One hairline, one radius, one accent.** BORDER=1, RADIUS=14 (iOS squircle),
  and the accent swatch are the only expressive channels. New components must
  reuse them.
- **Cards float, on one shadow.** Every `Paper` and the sidebar carry the
  `SHADOW` token — a two-layer lift, nothing more. `elevation` stays `0` so
  MUI's own shadow scale never enters; `AppBar` and `Button` keep their
  elevation turned off. No ad-hoc `boxShadow`, no drop-shadow filters: a
  surface that needs lift uses `SHADOW`, a recess uses `surfaceSunken`.
- **Glass is for chrome only.** Translucency, blur (`backdrop-filter`), and the
  faint body gradient are allowed on the sidebar and the mobile bar via the
  `GLASS` tokens. Working surfaces — `Paper` panels, the canvas, dialogs — stay
  opaque so the drawing underneath stays readable. A working surface that reads
  `GLASS` is a bug.
- **One accent, disciplined use.** `accent` is reserved for the primary action
  on a surface and for the active state of a tool (contained Save button;
  selected ToggleButton; `:focus-visible` outline; text selection). It is not
  used for headings, links, dividers, or emphasis.
- **Every async surface has three states.** `LoadingState`, `EmptyState`, and
  `ErrorState` in `src/components/LoadingState.tsx` are the only permitted
  shapes. New feature code composes them; it does not invent a fourth.
- **One destructive dialog.** Every irreversible action routes through
  `useConfirm()` (`src/components/ConfirmDialogProvider.tsx`). The confirm
  button uses `color="error"` when `destructive: true`, otherwise `primary`.
- **Toggle-like controls expose `aria-pressed`.** Applies to `Button` acting as
  a toggle (Show/hide labels, plate, buffer) and to `ToggleButton` state.
- **Tooltips describe, they do not rename.** `MuiTooltip.defaultProps.describeChild = true`.
  A control's accessible name is its label; the tooltip is `aria-describedby`
  content. WCAG 2.5.3 (Label in Name).
- **Icon-only `IconButton` carries an `aria-label`.** Undo, redo, delete, and
  the per-row Delete in the Open dialog all follow this without exception.
- **The SVG canvas is `role="application"` with a descriptive label.**
  `TrayCanvas` announces pocket count and the interaction model in one string.
- **The 3D viewer is `role="img"` with a triangle count.** `TrayViewer3D`
  announces `"Three-dimensional preview of the tray, N triangles"`. It is
  lazily loaded — three.js is not in the first paint.
- **One `<main>`, one `<h1>` per route.** The designer's `<h1>` is the open
  tray's name; other routes use a static title.
- **Real URLs, no view switch.** `AppShell` renders an `Outlet` and `routes.tsx`
  owns the segment map. Copying a URL and using the back button both work.
- **Last-resort recovery is a rendered surface.** `AppErrorBoundary` shows a
  reload path; a render failure does not leave the operator on a blank page.

## Measured quality floor

Recorded from a headless-browser pass at 1280×800, 834×1112, and 390×844 in
both colour schemes. These are outcomes of the rules above; they are recorded
so a future change that regresses them shows up as a regression.

- Horizontal overflow at every viewport, both schemes: `0 px`.
- Text contrast, light mode: `7.87:1` to `17.39:1` (all AAA).
- Text contrast, dark mode: `7.32:1` to `15.3:1` (all AAA).
- Focus ring measured on-page: `2px solid rgb(31,92,139)` light,
  `2px solid rgb(121,182,228)` dark.
- Landmarks: exactly one `<main>`, exactly one `<h1>` per route.
- Tabbable controls on the designer: `58`.
- Impeccable static detector: `0` findings across `src/` and `index.html`.

## Not canonized

- The wordmark in `AppShell` sets `fontWeight: 650` inline. This is a one-off
  above the h1 weight (600) applied only to the "ShapePilot" text. A value
  used once is not a token; a future second use should either adopt `600` or
  promote `650` into the type scale.
