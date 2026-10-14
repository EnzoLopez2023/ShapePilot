// A case of dadoed shelves for finished keycap trays.
//
// Parametric and stateless on the server: the whole design is the dozen numbers
// in the panel on the right, kept in this browser (state/params.ts). What comes
// out is a cut list and one Shaper SVG per panel, which is the only artefact a
// wooden case actually needs -- there is no mesh to print. The 3D view is the
// same panels assembled, built from those cut drawings (model/solid.ts).
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Divider, FormControlLabel, Paper, Stack, Switch, Table, TableBody,
  TableCell, TableHead, TableRow, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
  useTheme,
} from '@mui/material'
import { zipSync, strToU8 } from 'fflate'
import LengthField from '../../components/LengthField.tsx'
import HoverTooltip from '../../components/HoverTooltip.tsx'
import { writeShaperSvg } from '../../export/shaperSvg.ts'
import { writeDxf } from '../../export/dxf.ts'
import { safeFilename, triggerDownload } from '../../export/download.ts'
import { formatLength } from '../../units.ts'
import { cabinetDims, checkCabinet, cutList, screwPositionsMm } from './model/cabinet.ts'
import { PANEL_DRAWINGS, PANEL_LABELS } from './export/cutDrawing.ts'
import type { PanelId } from './export/cutDrawing.ts'
import {
  DEFAULT_CABINET_SETTINGS, loadCabinetSettings, saveCabinetSettings,
} from './state/params.ts'
import type { CabinetSettings } from './state/params.ts'
import CabinetElevations from './components/CabinetElevations.tsx'
import { cabinetSolid } from './model/solid.ts'
import type { CabinetParams } from './model/cabinet.ts'
import { LoadingState } from '../../components/LoadingState.tsx'

// three.js is a third of the bundle and the drawings are the default view, so
// the viewer is only fetched when someone actually switches to 3D.
const SolidViewer3D = lazy(() => import('../../components/viewport3d/SolidViewer3D.tsx'))

const PANEL_IDS: PanelId[] = ['side', 'top-bottom', 'back']

/** The wall half of the cleat: not part of the case, so not in the case colour. */
const WALL_CLEAT_COLOUR = '#8c7a62'

export default function CabinetPage() {
  const [settings, setSettings] = useState<CabinetSettings>(DEFAULT_CABINET_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => { setSettings(loadCabinetSettings()); setLoaded(true) }, [])
  useEffect(() => { if (loaded) saveCabinetSettings(settings) }, [loaded, settings])

  const { imperial, view, ...rawParams } = settings
  const set = (patch: Partial<CabinetSettings>) =>
    setSettings(current => ({ ...current, ...patch }))

  // Keyed on the case's own numbers, so flipping units or views neither rebuilds
  // the solid nor moves the 3D camera.
  const paramsKey = JSON.stringify(rawParams)
  const params = useMemo(() => JSON.parse(paramsKey) as CabinetParams, [paramsKey])
  const dims = useMemo(() => cabinetDims(params), [params])
  const rows = useMemo(() => cutList(params), [params])
  const warnings = useMemo(() => checkCabinet(params), [params])
  const len = (mm: number) => formatLength(mm, imperial)

  const theme = useTheme()
  const solid = useMemo(() => (view === '3d' ? cabinetSolid(params) : null), [view, params])
  const extras = useMemo(() => solid && [
    { mesh: solid.trays, color: theme.palette.primary.main },
    ...(solid.wallCleat ? [{ mesh: solid.wallCleat, color: WALL_CLEAT_COLOUR }] : []),
  ], [solid, theme.palette.primary.main])

  const download = (panel: PanelId, format: 'svg' | 'dxf') => {
    const drawing = PANEL_DRAWINGS[panel](settings)
    const base = safeFilename(`cabinet_${settings.trayCount}_${panel}`)
    if (format === 'svg') {
      triggerDownload(writeShaperSvg(drawing), `${base}.svg`, 'image/svg+xml')
    } else {
      triggerDownload(writeDxf(drawing), `${base}.dxf`, 'image/vnd.dxf')
    }
  }

  const downloadAll = () => {
    const files: Record<string, Uint8Array> = {}
    for (const panel of PANEL_IDS) {
      files[`${safeFilename(`cabinet_${panel}`)}.svg`] =
        strToU8(writeShaperSvg(PANEL_DRAWINGS[panel](settings)))
    }
    files['CUT_LIST.txt'] = strToU8(
      `Keycap tray cabinet — ${settings.trayCount} trays\n` +
      `Overall ${len(dims.overallWidthMm)} wide × ${len(dims.overallHeightMm)} high × ` +
      `${len(dims.panelDepthMm)} deep\n\n` +
      rows.map(r =>
        `${r.count} × ${r.part}: ${len(r.lengthMm)} × ${len(r.widthMm)} × ${len(r.thicknessMm)}` +
        `\n    ${r.note}`).join('\n') +
      `\n\nSlots: ${settings.trayCount} at ${len(dims.pitchMm)} pitch ` +
      `(${len(settings.dadoHeightMm)} dado + ${len(settings.gapMm)} clear).\n` +
      `Dados: ${dims.dadoFloorsMm.length} per side, ${len(settings.dadoDepthMm)} deep, ` +
      `floors at ${dims.dadoFloorsMm.map(v => len(v)).join(', ')} from the bottom end.\n` +
      `One gap of solid side below the lowest dado, and the same above the highest.\n` +
      (dims.cleat
        ? `Back groove: ${len(dims.backRabbetMm)} wide × ${len(dims.backRabbetMm)} deep in all ` +
          `four pieces, ${len(dims.backInsetMm)} in from the rear edge.\n` +
          `French cleat: the case half under the top, behind the back, long face to the wall; ` +
          `the spacer on the bottom behind the back. Mount the wall half with its high edge ` +
          `${len(dims.cleat.wallCleatDropMm)} below where the top of the case should be.\n`
        : `Back rabbet: ${len(dims.backRabbetMm)} × ${len(dims.backRabbetMm)} in all four pieces.\n`) +
      `Screws: through each side into the top and bottom at ` +
      `${screwPositionsMm(settings).map(v => len(v)).join(', ')} from the front edge, ` +
      `${len(settings.stockMm / 2)} in from each end.\n`)
    triggerDownload(
      zipSync(files, { level: 6 }),
      `${safeFilename(`cabinet_${settings.trayCount}_trays`)}.zip`,
      'application/zip')
  }

  const panel = { display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' } as const

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 320px' },
        gridTemplateRows: 'auto minmax(0, 1fr)',
        gap: 1.5,
        height: '100%',
        minHeight: 0,
        p: 1.5,
      }}
    >
      <Paper component="header" sx={{ gridColumn: '1 / -1', px: 2, py: 1.5 }}>
        <Stack
          direction="row" spacing={2}
          sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
        >
          <Typography variant="h3" component="h1">Tray cabinet</Typography>
          <ToggleButtonGroup
            exclusive size="small" value={view}
            aria-label="Canvas view"
            onChange={(_e, v) => v && set({ view: v })}
          >
            <ToggleButton value="2d">Drawings</ToggleButton>
            <ToggleButton value="3d">3D</ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 220 }}>
            {settings.trayCount} trays · {len(dims.overallWidthMm)} × {len(dims.overallHeightMm)} ×{' '}
            {len(dims.panelDepthMm)} · {dims.dadoFloorsMm.length} dados a side
            {dims.cleat ? ' · French cleat' : ''}
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            <Tooltip title="Every panel as a Shaper SVG, plus the cut list as a text file.">
              <Button size="small" variant="contained" onClick={downloadAll}>
                All panels (zip)
              </Button>
            </Tooltip>
            {PANEL_IDS.map(id => (
              <Button key={id} size="small" variant="outlined" onClick={() => download(id, 'svg')}>
                {PANEL_LABELS[id]}
              </Button>
            ))}
          </Stack>
        </Stack>
      </Paper>

      <Paper sx={{ ...panel }}>
        {view === '3d' && solid && extras ? (
          <Box sx={{ position: 'relative', flex: 1, minHeight: 360 }}>
            <Suspense fallback={<LoadingState label="Loading the 3D view…" />}>
              <SolidViewer3D mesh={solid.caseMesh} extras={extras} up="z" label="the tray cabinet"
              />
            </Suspense>
            <Typography
              variant="body2" color="text.secondary"
              sx={{ position: 'absolute', left: 12, bottom: 8, pointerEvents: 'none' }}
            >
              {settings.trayCount} trays seated
              {dims.cleat ? ' · wall cleat shown hung, in brown' : ''}
            </Typography>
          </Box>
        ) : (
          <CabinetElevations params={params} />
        )}
      </Paper>

      <Paper sx={{ ...panel, order: { xs: -1, md: 0 } }}>
        <Stack spacing={1.5} sx={{ p: 1.5, overflowY: 'auto', minHeight: 0 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h3" component="h2">Case</Typography>
            <ToggleButtonGroup
              exclusive size="small" value={imperial ? 'in' : 'mm'}
              aria-label="Display units"
              onChange={(_e, v) => v && set({ imperial: v === 'in' })}
            >
              <ToggleButton value="mm">mm</ToggleButton>
              <ToggleButton value="in">in</ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          {warnings.map(w => (
            <Alert key={w.code} severity="warning" sx={{ py: 0 }}>{w.message}</Alert>
          ))}

          <HoverTooltip title="How many trays the case holds. Every one rides in a dado of its own, so this is also the number of dados cut in each side.">
            <LengthField
              label="Trays" imperial={false} valueMm={settings.trayCount}
              onChangeMm={v => set({ trayCount: Math.max(1, Math.round(v)) })}
            />
          </HoverTooltip>

          <Divider textAlign="left">
            <Typography variant="caption" color="text.secondary">Tray</Typography>
          </Divider>
          <Stack direction="row" spacing={1}>
            <LengthField
              label="Width" imperial={imperial} valueMm={settings.trayWidthMm}
              hint="Tray width across the case. The S76 keycap tray is 249 mm."
              onChangeMm={v => set({ trayWidthMm: v })}
            />
            <LengthField
              label="Depth" imperial={imperial} valueMm={settings.trayDepthMm}
              hint="Tray depth into the case. This is also the interior depth in front of the back panel, so a tray slides in until it meets the back."
              onChangeMm={v => set({ trayDepthMm: v })}
            />
          </Stack>
          <LengthField
            label="Tray thickness" imperial={imperial} valueMm={settings.trayThicknessMm}
            hint="Floor plus pocket depth — 2.4 + 4 = 6.4 mm on the usual keycap tray. Only the dado height has to clear it."
            onChangeMm={v => set({ trayThicknessMm: v })}
          />

          <Divider textAlign="left">
            <Typography variant="caption" color="text.secondary">Dados</Typography>
          </Divider>
          <Stack direction="row" spacing={1}>
            <LengthField
              label="Dado height" imperial={imperial} valueMm={settings.dadoHeightMm}
              hint="A little over the tray thickness so a tray never binds — 7 mm for a 6.4 mm tray."
              onChangeMm={v => set({ dadoHeightMm: v })}
            />
            <LengthField
              label="Dado depth" imperial={imperial} valueMm={settings.dadoDepthMm}
              hint="How far each dado is let into the side. Keep it under half the stock thickness."
              onChangeMm={v => set({ dadoDepthMm: v })}
            />
          </Stack>
          <LengthField
            label="Gap between dados" imperial={imperial} valueMm={settings.gapMm}
            hint="Solid side material between one dado and the next. This is the caps' headroom: 17 mm clears KSA."
            onChangeMm={v => set({ gapMm: v })}
          />
          <LengthField
            label="Slide clearance" imperial={imperial} valueMm={settings.slideClearanceMm}
            hint="Total side-to-side slop on a tray, split between the two dados."
            onChangeMm={v => set({ slideClearanceMm: v })}
          />

          <Divider textAlign="left">
            <Typography variant="caption" color="text.secondary">Stock</Typography>
          </Divider>
          <Stack direction="row" spacing={1}>
            <LengthField
              label="Case stock" imperial={imperial} valueMm={settings.stockMm}
              hint="Sides, top and bottom. 1/2 in = 12.7 mm."
              onChangeMm={v => set({ stockMm: v })}
            />
            <LengthField
              label="Back" imperial={imperial} valueMm={settings.backMm}
              hint="Back panel, housed in a rabbet of the same size in all four pieces. 1/4 in = 6.35 mm."
              onChangeMm={v => set({ backMm: v })}
            />
          </Stack>

          <Divider textAlign="left">
            <Typography variant="caption" color="text.secondary">Mounting</Typography>
          </Divider>
          <HoverTooltip title="Hang the case on a 45° French cleat. The back moves forward by the cleat thickness and sits in a groove, leaving a hidden pocket behind it for the case cleat, a spacer, and the wall cleat.">
            <FormControlLabel
              control={
                <Switch
                  size="small" checked={settings.frenchCleat}
                  onChange={e => set({ frenchCleat: e.target.checked })}
                />
              }
              label="French cleat"
            />
          </HoverTooltip>
          {settings.frenchCleat && (
            <Stack direction="row" spacing={1}>
              <LengthField
                label="Cleat stock" imperial={imperial} valueMm={settings.cleatThicknessMm}
                hint="Cleat thickness. The back is set this far forward, so the cleats hide behind it and the case hangs flush to the wall."
                onChangeMm={v => set({ cleatThicknessMm: v })}
              />
              <LengthField
                label="Cleat height" imperial={imperial} valueMm={settings.cleatHeightMm}
                hint="Each cleat's long face after the 45° rip. At least twice the stock, so the short face is not a sliver."
                onChangeMm={v => set({ cleatHeightMm: v })}
              />
            </Stack>
          )}

          <Divider textAlign="left">
            <Typography variant="caption" color="text.secondary">Cut list</Typography>
          </Divider>
          <Table size="small" aria-label="Cut list">
            <TableHead>
              <TableRow>
                <TableCell>Part</TableCell>
                <TableCell align="right">No.</TableCell>
                <TableCell align="right">Size</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.part}>
                  <TableCell>
                    {r.part}
                    <Typography variant="caption" display="block" color="text.secondary">
                      {r.note}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{r.count}</TableCell>
                  <TableCell align="right">
                    {len(r.lengthMm)} × {len(r.widthMm)}
                    <Typography variant="caption" display="block" color="text.secondary">
                      {len(r.thicknessMm)} stock
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Typography variant="body2" color="text.secondary">
            Slots at {len(dims.pitchMm)} pitch, {len(dims.headroomMm)} clear above each seated
            tray. Each dado holds {len(dims.engagementMm)} of the tray's edge. Screws through the
            sides at {screwPositionsMm(settings).map(v => len(v)).join(', ')} from the front edge,
            {' '}{len(settings.stockMm / 2)} in from each end.
            {dims.cleat && (
              <> Mount the wall cleat with its high edge {len(dims.cleat.wallCleatDropMm)} below
                where the top of the case should be.</>
            )}
          </Typography>
        </Stack>
      </Paper>
    </Box>
  )
}
