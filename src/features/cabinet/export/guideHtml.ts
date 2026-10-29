// The rough cut list and build guide as one standalone, printable HTML page.
//
// A page rather than React so the dialog's preview, the print and the download
// are the same thing, and the downloaded file opens anywhere without the app.
import { fitsReach } from '../../../model/benchpilot.ts'
import type { BenchPilotReach } from '../../../model/benchpilot.ts'
import { formatLength } from '../../../units.ts'
import { cabinetDims } from '../model/cabinet.ts'
import type { CabinetParams } from '../model/cabinet.ts'
import { SHEET_MM, buildGuide, cuttingOrder, roughCutList } from '../model/guide.ts'
import type { Figure } from '../model/guide.ts'
import { breakdownSvg, caseSvg, cleatSvg, explodedSvg, panelSvg } from './guideSvg.ts'

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const STYLE = `
  :root { color-scheme: light; }
  body { font: 14px/1.5 system-ui, sans-serif; color: #1b1b1b; margin: 0; padding: 24px; max-width: 820px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 8px; border-bottom: 1px solid #bbb; padding-bottom: 4px; }
  h3 { font-size: 14px; margin: 0 0 2px; }
  p.sub { margin: 0; color: #555; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #555; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  .step { break-inside: avoid; margin: 14px 0; padding-left: 12px; border-left: 3px solid #888; }
  .step ol, .step ul { margin: 6px 0 6px 18px; padding: 0; }
  .figures { margin: 8px 0; }
  figure { margin: 0; padding: 8px; background: #fafafa; border: 1px solid #e2e2e2; border-radius: 6px; text-align: center; }
  .caution { color: #7a4b00; }
  .muted { color: #666; }
  .no { color: #a11; font-weight: 600; }
  @media print { body { padding: 0; } }
`

export interface GuideOptions {
  title: string
  imperial: boolean
  marginMm: number
  reach: BenchPilotReach | null
}

export function guideHtml(p: CabinetParams, o: GuideOptions): string {
  const f = (mm: number) => formatLength(mm, o.imperial)
  const d = cabinetDims(p)
  const rows = roughCutList(p, o.marginMm)
  const order = cuttingOrder(rows)
  const guide = buildGuide(p, o.marginMm, f)
  const figure = (id: Figure): string => ({
    breakdown: () => breakdownSvg(order, f),
    case: () => caseSvg(p, f),
    exploded: () => explodedSvg(p),
    side: () => panelSvg('side', p, f),
    'top-bottom': () => panelSvg('top-bottom', p, f),
    back: () => panelSvg('back', p, f),
    cleat: () => cleatSvg(p, f),
  })[id]()

  const rough = rows.map(r => {
    const fit = r.machine === 'saw' ? '—'
      : !o.reach ? ''
        : fitsReach(o.reach, r.roughLengthMm, r.roughWidthMm) ? 'Fits' : '<span class="no">Too big</span>'
    return `<tr>
      <td>${esc(r.part)}<div class="muted">${r.machine === 'origin' ? 'cut on the Origin' : 'sawn to size'}</div></td>
      <td class="n">${r.count}</td>
      <td class="n"><strong>${f(r.roughLengthMm)} × ${f(r.roughWidthMm)}</strong><div class="muted">${f(r.thicknessMm)} stock</div></td>
      <td class="n">${r.machine === 'origin' ? `${f(r.finishedLengthMm)} × ${f(r.finishedWidthMm)}` : '—'}</td>
      ${o.reach ? `<td>${fit}</td>` : ''}
    </tr>`
  }).join('')

  const sheets = order.map(g =>
    `<li>${f(g.thicknessMm)} plywood: ${g.sheets.length} sheet${g.sheets.length === 1 ? '' : 's'} of ${f(SHEET_MM.lengthMm)} × ${f(SHEET_MM.widthMm)}</li>`).join('')

  const steps = guide.steps.map((s, i) => `
    <div class="step">
      <h3>${i + 1}. ${esc(s.title)}</h3>
      <div class="muted">${esc(s.summary)}</div>
      <div class="figures">${s.figures.map(id => `<figure>${figure(id)}</figure>`).join('')}</div>
      <ol>${s.instructions.map(t => `<li>${esc(t)}</li>`).join('')}</ol>
      ${s.cautions.length ? `<ul class="caution">${s.cautions.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </div>`).join('')

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(o.title)}</title><meta name="viewport" content="width=device-width, initial-scale=1">
<style>${STYLE}</style></head><body>
<h1>${esc(o.title)}</h1>
<p class="sub">${p.trayCount} trays · ${f(d.overallWidthMm)} wide × ${f(d.overallHeightMm)} tall × ${f(d.panelDepthMm)} deep${d.cleat ? ' · French cleat' : ''}</p>

<h2>Rough cut list</h2>
<p class="muted">Saw each blank to the rough size, then place it on the Origin's work area and cut the finished panel from it. Each blank is ${f(o.marginMm)} over the panel, rounded up.</p>
<table><thead><tr><th>Part</th><th class="n">No.</th><th class="n">Rough size</th><th class="n">Finished</th>${o.reach ? '<th>In reach</th>' : ''}</tr></thead>
<tbody>${rough}</tbody></table>
<ul>${sheets}</ul>
<p class="muted">Sheet count is the strips ripped from full sheets, with kerf; plan for a little more for defects.</p>

<h2>Build guide</h2>
${steps}

<h2>Hardware</h2>
<table><tbody>${guide.hardware.map(h => `<tr><td>${esc(h.item)}</td><td class="n">${esc(h.qty)}</td></tr>`).join('')}</tbody></table>
</body></html>`
}
