// The case drawn twice: head on, and the side panel laid flat.
//
// Front elevation is what the thing is -- every slot with a tray in it, so the
// stack reads at a glance. The side is the piece that actually gets cut, drawn
// the way the Shaper SVG draws it (inner face up, front edge left), so the
// screen and the cut file agree.
import { Box, Stack, Typography } from '@mui/material'
import type { Theme } from '@mui/material'
import { cabinetDims } from '../model/cabinet.ts'
import type { CabinetParams } from '../model/cabinet.ts'
import { formatMeasure, formatLength, formatSize } from '../../../units.ts'

const PAD = 26

/** Colours shared by every drawing in the cabinet designer. */
export const CABINET_VARS = {
  '--cab-case': (theme: Theme) => (theme.palette.mode === 'dark' ? '#3a342c' : '#e8e2d6'),
  '--cab-void': (theme: Theme) => theme.palette.background.default,
  '--cab-line': (theme: Theme) => theme.palette.text.primary,
  '--cab-dado': (theme: Theme) => (theme.palette.mode === 'dark' ? '#6f6a5e' : '#b9b3a6'),
  '--cab-tray': (theme: Theme) => theme.palette.primary.main,
  '--cab-tray-line': (theme: Theme) => theme.palette.primary.dark,
  '--cab-text': (theme: Theme) => theme.palette.text.secondary,
  '--cab-reach': (theme: Theme) => theme.palette.info.main,
}

export default function CabinetElevations({ params, imperial }: { params: CabinetParams; imperial: boolean }) {
  const p = params
  const mm = (v: number) => formatMeasure(v, imperial)
  const sizeLabel = (a: number, b: number) => formatSize([a, b], imperial).replace(' × ', ' by ')
  const d = cabinetDims(p)

  // -- front elevation: X across the case, Y down from the top ---------------
  const fw = d.overallWidthMm
  const fh = d.overallHeightMm
  const trays = Array.from({ length: p.trayCount }, (_, i) => {
    // Slot i's dado floor, from the bottom of the case; drawn from the top.
    const floor = d.dadoFloorsMm[i]
    return {
      y: fh - floor - p.trayThicknessMm,
      x: p.stockMm - p.dadoDepthMm + p.slideClearanceMm / 2,
      w: p.trayWidthMm,
    }
  })

  const front = (
    <svg
      viewBox={`${-PAD} ${-PAD} ${fw + PAD * 2} ${fh + PAD * 2}`}
      role="img"
      aria-label={`Front elevation, ${sizeLabel(fw, fh)}, ${p.trayCount} slots`}
      style={{ width: '100%', height: 'auto', maxHeight: 460 }}
    >
      <rect x={0} y={0} width={fw} height={fh} fill="var(--cab-case)" stroke="var(--cab-line)" strokeWidth={0.8} />
      <rect
        x={p.stockMm} y={p.stockMm}
        width={d.interiorWidthMm} height={d.interiorHeightMm}
        fill="var(--cab-void)" stroke="var(--cab-line)" strokeWidth={0.5}
      />
      {trays.map((t, i) => (
        <rect
          key={i} x={t.x} y={t.y} width={t.w} height={p.trayThicknessMm}
          fill="var(--cab-tray)" stroke="var(--cab-tray-line)" strokeWidth={0.4}
        />
      ))}
      {/* The dados, shown as the pockets they are in each side. */}
      {d.dadoFloorsMm.map((floor, i) => (
        <g key={`d${i}`} fill="var(--cab-dado)">
          <rect x={p.stockMm - p.dadoDepthMm} y={fh - floor - p.dadoHeightMm} width={p.dadoDepthMm} height={p.dadoHeightMm} />
          <rect x={fw - p.stockMm} y={fh - floor - p.dadoHeightMm} width={p.dadoDepthMm} height={p.dadoHeightMm} />
        </g>
      ))}
      <text x={fw / 2} y={-8} textAnchor="middle" fontSize={11} fill="var(--cab-text)">
        {mm(fw)}
      </text>
      <text
        x={-10} y={fh / 2} textAnchor="middle" fontSize={11} fill="var(--cab-text)"
        transform={`rotate(-90 ${-10} ${fh / 2})`}
      >
        {mm(fh)}
      </text>
    </svg>
  )

  // -- the side panel, flat: X is the case depth, Y the height ---------------
  const sw = d.panelDepthMm
  const sidePad = imperial ? PAD + 22 : PAD
  const sh = d.overallHeightMm
  const side = (
    <svg
      viewBox={`${-PAD} ${-PAD} ${sw + PAD + sidePad} ${sh + PAD * 2}`}
      role="img"
      aria-label={`Side panel, ${sizeLabel(sw, sh)}, with ${d.dadoFloorsMm.length} dados`}
      style={{ width: '100%', height: 'auto', maxHeight: 460 }}
    >
      <rect x={0} y={0} width={sw} height={sh} fill="var(--cab-case)" stroke="var(--cab-line)" strokeWidth={0.8} />
      {/* Back rabbet, along the rear edge. */}
      <rect
        x={p.trayDepthMm} y={0} width={d.backRabbetMm} height={sh}
        fill="var(--cab-dado)" stroke="none"
      />
      {d.dadoFloorsMm.map((floor, i) => (
        <g key={i}>
          <rect
            x={0} y={sh - floor - p.dadoHeightMm} width={p.trayDepthMm} height={p.dadoHeightMm}
            fill="var(--cab-dado)"
          />
          <text x={sw + 3} y={sh - floor - 1} fontSize={9} fill="var(--cab-text)">
            {formatLength(floor, imperial)}
          </text>
        </g>
      ))}
      {/* Behind the back: the cleats and spacer it hides, as dashed outlines. */}
      {d.cleat && [d.cleat.caseProfile, d.cleat.spacerProfile, d.cleat.wallProfile].map((ring, i) => (
        <polygon
          key={`c${i}`}
          points={ring.map(([u, v]) => `${u},${sh - v}`).join(' ')}
          fill="none" stroke="var(--cab-line)" strokeWidth={0.6}
          strokeDasharray={i === 2 ? '1.5 2' : '4 2'}
        />
      ))}
      <text x={sw / 2} y={-8} textAnchor="middle" fontSize={11} fill="var(--cab-text)">
        {mm(sw)} · front edge left
      </text>
    </svg>
  )

  return (
    <Box
      sx={{
        ...CABINET_VARS,
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', lg: '1.3fr 1fr' },
        gap: 2,
        p: 2,
        minHeight: 0,
        overflow: 'auto',
      }}
    >
      <Stack spacing={1} sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" component="h2">Front</Typography>
        {front}
      </Stack>
      <Stack spacing={1} sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" component="h2">
          Side panel · dado floors from the bottom end
        </Typography>
        {side}
      </Stack>
    </Box>
  )
}
