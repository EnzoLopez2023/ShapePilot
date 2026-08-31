// The project's trays, drawn.
//
// A tray list gives names and pocket counts, which is exactly what you cannot
// recognise a tray by. Sitting under the photos, the drawing answers the
// question the photos raise: this is the set, and these are the trays cut for
// it.
//
// Each tray's geometry is fetched on its own -- the list summary carries no
// outline and no pockets, and a project holds a handful of trays, so a request
// each is cheaper than widening the summary for every caller that does not
// want it.
import { useEffect, useState } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import * as trays from '../../keycap-tray/service.ts'
import type { TrayDesign } from '../../keycap-tray/model/types.ts'
import { LoadingState } from '../../../components/LoadingState.tsx'
import TrayThumbnail from './TrayThumbnail.tsx'

export interface TrayPreviewsProps {
  trays: { id: string; name: string; pocketCount: number }[]
}

export default function TrayPreviews({ trays: summaries }: TrayPreviewsProps) {
  const navigate = useNavigate()
  const [designs, setDesigns] = useState<Record<string, TrayDesign>>({})
  const [loading, setLoading] = useState(false)

  const ids = summaries.map(s => s.id).join(',')

  useEffect(() => {
    if (!ids) { setDesigns({}); return }
    let cancelled = false
    setLoading(true)
    void Promise.all(ids.split(',').map(id =>
      // A tray that will not load is simply not drawn. A preview is a
      // convenience and must never be able to take the project page down.
      trays.getDesign(id).then(design => [id, design] as const).catch(() => null)))
      .then(results => {
        if (cancelled) return
        setDesigns(Object.fromEntries(results.filter(r => r !== null)))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [ids])

  if (!summaries.length) return null
  if (loading && !Object.keys(designs).length) {
    return <LoadingState label="Drawing the trays…" fill={false} />
  }

  return (
    <Stack spacing={1}>
      {summaries.map(summary => {
        const design = designs[summary.id]
        if (!design) return null
        return (
          <Box
            key={summary.id}
            role="button"
            tabIndex={0}
            aria-label={`Open ${summary.name}`}
            onClick={() => navigate(`/keycap-tray/${summary.id}`)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                navigate(`/keycap-tray/${summary.id}`)
              }
            }}
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              p: 1,
              cursor: 'pointer',
              color: 'text.primary',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Box sx={{ height: 96, mb: 0.5 }}>
              <TrayThumbnail
                design={design}
                label={`${summary.name}, ${summary.pocketCount} pockets`}
              />
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{summary.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {summary.pocketCount} {summary.pocketCount === 1 ? 'pocket' : 'pockets'}
            </Typography>
          </Box>
        )
      })}
    </Stack>
  )
}
