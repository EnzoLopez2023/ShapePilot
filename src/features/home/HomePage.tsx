// Where a session starts.
//
// Two questions, in the order a maker actually asks them: what was I doing,
// and what am I doing now. The first is answered by drawing the thing they last
// touched at size, with one action on it; the second by four ways in, each
// showing what it makes rather than naming it.
//
// The counts sit between the two as a title block, the way a drawing carries
// its own measurements -- not as four framed figures, which would make the
// numbers the point. They are context, not the work.
import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Paper, Stack, Typography, useTheme } from '@mui/material'
import ArrowIcon from '@mui/icons-material/ArrowForwardRounded'
import * as projectsApi from '../keycap-projects/service.ts'
import * as traysApi from '../keycap-tray/service.ts'
import { listDocuments } from '../../services/designDocuments.ts'
import type { TrayDesign } from '../keycap-tray/model/types.ts'
import { errorMessage } from '../../services/errors.ts'
import { ErrorState, LoadingState } from '../../components/LoadingState.tsx'
import TrayThumbnail from '../keycap-projects/components/TrayThumbnail.tsx'
import { describeWhen, summarise } from './model/workshop.ts'
import type { Workshop } from './model/workshop.ts'
import {
  BambuArtwork, KeycapArtwork, PlaygroundArtwork, ShaperArtwork,
} from './components/PathArtwork.tsx'
import './home.css'

interface Path {
  to: string
  name: string
  makes: string
  artwork: () => React.ReactElement
  /** The keycap tray is the capability this workbench was built around. */
  lead?: boolean
}

const PATHS: Path[] = [
  {
    to: '/keycap-tray',
    name: 'Keycap tray',
    makes: 'Lay pockets into a Systainer insert and cut it for a set.',
    artwork: KeycapArtwork,
    lead: true,
  },
  {
    to: '/shaper-designer',
    name: 'Shaper designer',
    makes: 'Draw a part and its cut line for the Origin.',
    artwork: ShaperArtwork,
  },
  {
    to: '/bambu-designer',
    name: 'Bambu designer',
    makes: 'Build a solid from primitives and holes for the X2D.',
    artwork: BambuArtwork,
  },
  {
    to: '/playground',
    name: 'AI playground',
    makes: 'Describe a part, then keep talking until it is right.',
    artwork: PlaygroundArtwork,
  },
]

export default function HomePage() {
  const theme = useTheme()
  const [workshop, setWorkshop] = useState<Workshop | null>(null)
  const [heroTray, setHeroTray] = useState<TrayDesign | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [projects, trays, documents] = await Promise.all([
        projectsApi.listProjects(),
        traysApi.listDesigns(),
        listDocuments(),
      ])
      const result = summarise(projects, trays, documents)
      setWorkshop(result)
      // The hero draws the real thing when the real thing is drawable. A
      // document has no cheap preview, so its card shows what that designer
      // makes instead -- which is still true, just not personal.
      if (result.latest?.kind === 'tray') {
        setHeroTray(await traysApi.getDesign(result.latest.id).catch(() => null))
      } else {
        setHeroTray(null)
      }
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading) return <LoadingState label="Opening the workshop…" />
  if (error || !workshop) {
    return <ErrorState message={error ?? 'The workshop could not be read.'} onRetry={() => void load()} />
  }

  const { latest, totals, empty } = workshop

  return (
    <Stack
      spacing={2.5}
      sx={{
        // The Bambu card's hole is cut out of the drawing's own frame, so it
        // needs that frame's colour as a paint rather than as a class.
        '--sp-surface': theme.palette.background.default,
        maxWidth: 1180,
      }}
    >
      <Box component="section" className="sp-rise" sx={{ animationDelay: '0ms' }}>
        <Typography variant="h1" component="h1" sx={{ mb: 0.5 }}>
          {empty ? 'Nothing on the bench yet' : 'Back at the bench'}
        </Typography>
        <Typography color="text.secondary">
          {empty
            ? 'Pick a machine and make the first thing.'
            : 'Pick up where you left off, or start something new.'}
        </Typography>
      </Box>

      {latest && (
        <Paper
          component="section"
          aria-label="Where you left off"
          className="sp-rise"
          sx={{
            animationDelay: '80ms',
            p: { xs: 1.5, md: 2.5 },
            display: 'grid',
            gap: { xs: 1.5, md: 2.5 },
            gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1.15fr)' },
            alignItems: 'center',
          }}
        >
          <Stack spacing={1.25} sx={{ minWidth: 0 }}>
            <Typography variant="body2" color="text.secondary">
              Last touched {describeWhen(latest.updatedAt)}
              {latest.context && ` · ${latest.context}`}
            </Typography>
            <Typography variant="h1" component="h2" sx={{ overflowWrap: 'anywhere' }}>
              {latest.name}
            </Typography>
            <Typography color="text.secondary">
              {latest.pieces} {latest.kind === 'tray'
                ? (latest.pieces === 1 ? 'pocket' : 'pockets')
                : (latest.pieces === 1 ? 'object' : 'objects')}
            </Typography>
            <Box>
              <Button
                component={RouterLink}
                to={latest.href}
                variant="contained"
                endIcon={<ArrowIcon />}
              >
                Resume
              </Button>
            </Box>
          </Stack>

          <Box
            className={heroTray ? 'sp-plot' : undefined}
            sx={{
              aspectRatio: { xs: '1.7 / 1', md: '1.55 / 1' },
              color: 'text.primary',
              bgcolor: 'background.default',
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              p: 1.5,
            }}
          >
            {heroTray
              ? <TrayThumbnail design={heroTray} label={`${latest.name}, drawn`} />
              : <PathArtworkFor kind={latest.kind} />}
          </Box>
        </Paper>
      )}

      {!empty && (
        <Box
          component="section"
          aria-label="What the workshop holds"
          className="sp-rise"
          sx={{ animationDelay: '160ms' }}
        >
          <Box
            component="dl"
            sx={{
              m: 0,
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(2, minmax(0, 1fr))',
                sm: 'repeat(5, minmax(0, 1fr))',
              },
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            {([
              ['Projects', totals.projects],
              ['Trays', totals.trays],
              ['Pockets', totals.pockets],
              ['Caps catalogued', totals.caps],
              ['Objects', totals.objects],
            ] as const).map(([label, value], index) => (
              <Box
                key={label}
                sx={{
                  px: 1.5,
                  py: 1.25,
                  borderLeft: index === 0 ? 0 : 1,
                  borderColor: 'divider',
                  // The grid wraps at xs, so the first of each row loses its rule.
                  '&:nth-of-type(2n + 1)': { borderLeft: { xs: 0, sm: 1 } },
                  '&:first-of-type': { borderLeft: 0 },
                }}
              >
                <Typography
                  component="dd"
                  className="sp-figure"
                  sx={{ m: 0, fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.15 }}
                >
                  {value.toLocaleString()}
                </Typography>
                <Typography component="dt" variant="body2" color="text.secondary">
                  {label}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <Box component="section" aria-label="Start something">
        <Box
          sx={{
            display: 'grid',
            gap: 1.5,
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, minmax(0, 1fr))',
              lg: 'repeat(3, minmax(0, 1fr))',
            },
          }}
        >
          {PATHS.map((path, index) => {
            const Artwork = path.artwork
            return (
              <Paper
                key={path.to}
                component={RouterLink}
                to={path.to}
                className="sp-card sp-rise"
                sx={{
                  animationDelay: `${240 + index * 70}ms`,
                  display: 'grid',
                  gap: 1.25,
                  p: 1.5,
                  textDecoration: 'none',
                  color: 'text.primary',
                  // The lead path takes the wide cell where there is room for
                  // one -- it is the capability this workbench was built around
                  // -- and lays out along it rather than stacking, so the extra
                  // width is used instead of padded around a small drawing.
                  gridColumn: path.lead ? { lg: 'span 2' } : undefined,
                  gridTemplateColumns: path.lead
                    ? { xs: '1fr', lg: 'minmax(0, 1.35fr) minmax(0, 1fr)' }
                    : '1fr',
                  alignItems: path.lead ? { lg: 'center' } : undefined,
                  '&:hover': { borderColor: 'text.secondary', bgcolor: 'action.hover' },
                }}
              >
                <Box
                  sx={{
                    // Close to each drawing's own proportions, so the frame is
                    // filled rather than padded around a shape that met on one
                    // axis and left the other empty.
                    aspectRatio: path.lead ? '1.75 / 1' : '1.85 / 1',
                    bgcolor: 'background.default',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 2,
                    p: 1.25,
                  }}
                >
                  <Artwork />
                </Box>
                <Box>
                  <Typography variant="h2" component="h2">{path.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{path.makes}</Typography>
                </Box>
              </Paper>
            )
          })}
        </Box>
      </Box>
    </Stack>
  )
}

/** The hero falls back to what that designer makes when it cannot draw the
 *  document itself. */
function PathArtworkFor({ kind }: { kind: string }) {
  if (kind === 'shaper') return <ShaperArtwork />
  if (kind === 'bambu') return <BambuArtwork />
  return <PlaygroundArtwork />
}
