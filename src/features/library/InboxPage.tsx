// The Library inbox: one new model at a time. Decide what it is (want /
// printed / archive) and where it lives (a category). Number keys file into
// categories, W/P/A set status, → skips.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material'
import ArchiveRoundedIcon from '@mui/icons-material/ArchiveRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import type { LibraryModel, LibraryStatus } from '../../../lib/contracts/library.ts'
import { EmptyState, LoadingState } from '../../components/LoadingState.tsx'
import { BackToLibrary } from './components/BackToLibrary.tsx'
import { LibraryThumb } from './components/LibraryThumb.tsx'
import { useToast } from './components/useToast.tsx'
import { categoryLabel, formatDimensions, formatDuration, formatGrams } from './model/format.ts'
import { libraryHelper, useLibraryHelper } from './model/helper.ts'
import { listModels, updateModel } from './service.ts'

function Key({ children }: { children: string }) {
  return (
    <Box component="kbd" sx={{ ml: 1, px: 0.5, border: 1, borderColor: 'divider', borderRadius: 0.5, fontSize: 11, fontFamily: 'monospace' }}>
      {children}
    </Box>
  )
}

export default function InboxPage() {
  const helper = useLibraryHelper()
  const toast = useToast()
  const [queue, setQueue] = useState<LibraryModel[] | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)

  useEffect(() => {
    listModels({ status: 'inbox', sort: 'recent', limit: 200 }).then(page => setQueue(page.items)).catch(() => setQueue([]))
  }, [])

  useEffect(() => {
    if (!helper.available) return
    libraryHelper.categories().then(r => setCategories(r.categories.filter(c => !c.startsWith('_')))).catch(() => undefined)
  }, [helper.available])

  const current = queue?.[0] ?? null

  const next = useCallback(() => {
    setQueue(q => (q ? q.slice(1) : q))
    setDone(n => n + 1)
  }, [])

  const decide = useCallback(async (status: LibraryStatus | null, category?: string) => {
    if (!current || busy) return
    setBusy(true)
    try {
      if (category && helper.available) await libraryHelper.file(current.id, category, status ?? undefined)
      // Status also goes through this server, so it applies even when the helper is unavailable.
      if (status) await updateModel(current.id, { status })
      next()
    } catch (cause) {
      toast.failure('Could not file this model', cause)
    } finally {
      setBusy(false)
    }
  }, [busy, current, helper.available, next, toast])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey) return
      const key = event.key.toLowerCase()
      if (key === 'w') void decide('want')
      else if (key === 'p') void decide('printed')
      else if (key === 'a') void decide('skip', '_Archive')
      else if (key === 'arrowright') next()
      else if (/^[1-9]$/.test(key) && categories[Number(key) - 1]) void decide('want', categories[Number(key) - 1])
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [categories, decide, next])

  return (
    <Stack spacing={2} sx={{ p: { xs: 1.5, md: 0 }, maxWidth: 1000 }}>
      <BackToLibrary />
      <Stack spacing={0.5}>
        <Typography variant="h1" component="h1">Inbox</Typography>
        <Typography color="text.secondary">
          Decide what each new model is for. Choosing a category moves its folder there; everything is undoable from
          Organize → History.
        </Typography>
      </Stack>

      {queue === null ? (
        <LoadingState label="Loading the inbox…" fill={false} />
      ) : !current ? (
        <EmptyState
          title={done ? `Inbox zero — ${done} model${done === 1 ? '' : 's'} triaged` : 'The inbox is empty'}
          description="New downloads land here automatically."
          action={<Button component={Link} to="/library" variant="outlined">Back to the Library</Button>}
        />
      ) : (
        <Paper variant="outlined" sx={{ p: 2, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '320px 1fr' } }} aria-live="polite">
          <Box sx={{ aspectRatio: '1', borderRadius: 1, overflow: 'hidden' }}>
            <LibraryThumb hash={current.thumbHash} alt={`${current.title} preview`} iconSize={64} />
          </Box>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">{queue.length} left{done ? ` · ${done} done` : ''}</Typography>
            <Typography variant="h2" component="h2">
              <Box component={Link} to={`/library/${current.id}`} sx={{ color: 'inherit' }}>{current.title}</Box>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {[current.designer && `by ${current.designer}`, current.formats.join(', ').toUpperCase(), formatDimensions(current.bbox),
                current.estSeconds ? `${formatDuration(current.estSeconds)} · ${formatGrams(current.estGrams)}` : null]
                .filter(Boolean).join(' · ')}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <Button variant="contained" startIcon={<StarRoundedIcon />} disabled={busy} onClick={() => void decide('want')}>
                Want to print<Key>W</Key>
              </Button>
              <Button variant="outlined" startIcon={<CheckCircleRoundedIcon />} disabled={busy} onClick={() => void decide('printed')}>
                Already printed<Key>P</Key>
              </Button>
              <Button startIcon={<ArchiveRoundedIcon />} disabled={busy} onClick={() => void decide('skip', '_Archive')}>
                Archive<Key>A</Key>
              </Button>
              <Button endIcon={<ChevronRightRoundedIcon />} disabled={busy} onClick={next}>
                Skip for now<Key>→</Key>
              </Button>
            </Stack>
            <Stack spacing={1}>
              <Typography variant="overline" color="text.secondary">File into a category (sets Want to print)</Typography>
              {helper.available ? (
                <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                  {categories.map((c, i) => (
                    <Button key={c} variant="outlined" disabled={busy} onClick={() => void decide('want', c)} sx={{ justifyContent: 'flex-start' }}>
                      {i < 9 && <Box component="kbd" sx={{ mr: 1, fontFamily: 'monospace', fontSize: 11 }}>{i + 1}</Box>}
                      {categoryLabel(c)}
                    </Button>
                  ))}
                </Box>
              ) : (
                <Alert severity="info">Moving folders needs the Library helper on your Mac. Status changes still save here.</Alert>
              )}
            </Stack>
          </Stack>
        </Paper>
      )}
      {toast.element}
    </Stack>
  )
}
