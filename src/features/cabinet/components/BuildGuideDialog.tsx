// The rough cut list and build guide, shown as the page it prints as.
import { useMemo, useRef } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material'
import { safeFilename, triggerDownload } from '../../../export/download.ts'
import type { BenchPilotFeed, BenchPilotReach } from '../../../model/benchpilot.ts'
import { guideHtml } from '../export/guideHtml.ts'
import type { CabinetParams } from '../model/cabinet.ts'

export default function BuildGuideDialog(
  { params, title, imperial, marginMm, reach, bitMm, feed, onClose }: {
    params: CabinetParams
    title: string
    imperial: boolean
    marginMm: number
    reach: BenchPilotReach | null
    bitMm: number
    feed: BenchPilotFeed
    onClose: () => void
  },
) {
  const frame = useRef<HTMLIFrameElement>(null)
  const html = useMemo(
    () => guideHtml(params, { title, imperial, marginMm, reach, bitMm, feed }),
    [params, title, imperial, marginMm, reach, bitMm, feed])
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Cut list and build guide</DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        <Box
          component="iframe" ref={frame} srcDoc={html} title="Cut list and build guide"
          sx={{ width: '100%', height: '70vh', border: 0, bgcolor: '#fff' }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => triggerDownload(html, `${safeFilename(title)}_guide.html`, 'text/html')}>
          Download
        </Button>
        <Button onClick={() => frame.current?.contentWindow?.print()}>Print</Button>
        <Button variant="contained" onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
