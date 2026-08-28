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

Restrained, low-clutter workbench. Flat surfaces separated by a single hairline
border. One radius. One accent, used only for the active tool and the primary
action on a surface. Type stays legible next to a technical drawing.

The inherited Hearth "glass panel" aesthetic was removed on purpose:
`src/KeycapTray/components/glass.ts` exists at Hearth commit
`f0b05fc1dbf53e8aa26c215d8e858894a2793871` and was deliberately not ported. In
the shipped code no component reads from a glass module and no MUI override
introduces translucency, blur, gradient, or elevation.

## Tokens

Single source: `src/theme/theme.ts`. Consumed through the MUI theme, not
duplicated as CSS variables. The theme is rebuilt when the mode flips
(`ThemeModeProvider.tsx`), so a light-only or dark-only value is a bug.

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
| `RADIUS` | `6`   | Paper, Button, ToggleButton, OutlinedInput, Chip, Tooltip, Alert, Dialog, ListItemButton — every rounded corner in the app. |
| `BORDER` | `1`   | Every visible edge. Paper, AppBar, Alert, outlined controls all use the same 1px hairline. Elevation is `0` everywhere. |

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

Designer surface (`src/features/keycap-tray/KeycapTrayPage.tsx`) — the only
workbench in Wave 1:

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

Panels are `MUI Paper`. Paper is flat (`elevation={0}`) with a `1px` border in
`divider` colour. `backgroundImage: none` is enforced so a Paper never picks up
MUI's default overlay gradient in dark mode.

## Named rules

- **One hairline, one radius, one accent.** BORDER=1, RADIUS=6, and the accent
  swatch are the only expressive channels. New components must reuse them.
- **Elevation is zero.** No `boxShadow`, no `elevation` prop above 0, no
  drop-shadow filters. The MUI defaults are turned off for `Paper`, `AppBar`,
  and `Button`. Depth is communicated by the hairline and by `surfaceSunken`,
  not by shadow.
- **No translucency, no blur, no gradient.** Not in `background`, not in `text`,
  not on `Paper`. This is a workbench, not glass.
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
