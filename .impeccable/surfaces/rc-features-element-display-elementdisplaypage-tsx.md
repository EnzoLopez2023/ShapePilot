---
version: 1
slug: "rc-features-element-display-elementdisplaypage-tsx"
primary_target: "src/features/element-display/ElementDisplayPage.tsx"
related_targets: ["src/features/element-display/element-display.css","display.html","widgets/element-edge/index.html"]
---

Operate: a read-only, glanceable current-job page for a household XENEON EDGE.
Primary target: src/features/element-display/ElementDisplayPage.tsx.
User-pinned black background, white primary type, orange progress/accents, matching adjacent clock/weather widgets. Do not modify the normal app theme.
840x696 vertical and 840x344 horizontal must keep the current job, progress, remaining minutes, layers, nozzle/bed actual+target, error/HMS summary and freshness legible. No navigation, controls, history or AMS/spool section.
Pairing starts on the display. A normal authenticated admin approves the visible single-use code in EL-ement Statistics; the iframe never starts Microsoft sign-in. Scoped revocable display access and server-held Bambu credentials preserve household boundaries.
Offline/stale/unreported data must never appear live or zero. Local previews are synthetic and labeled; production has no demo fallback.
Physical iframe landing-page rendering passed. New-page pairing, origin storage persistence and live telemetry still require physical acceptance after authorized deployment.
