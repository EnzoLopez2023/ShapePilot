// Review: confirm which model each printer job printed, and look at models
// that share the same geometry.
//
// Jobs come from the household printer's ledger (EL-ement Statistics), read
// in-process now that the Library lives beside it -- Workshop had to fetch
// them over HTTP with a shared key.
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Alert, Autocomplete, Box, Button, Card, CardActionArea, Chip, Paper, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import SyncRoundedIcon from '@mui/icons-material/SyncRounded'
import type { LibraryDuplicateGroup, LibraryModel, LibraryPrint } from '../../../lib/contracts/library.ts'
import { EmptyState, LoadingState } from '../../components/LoadingState.tsx'
import { BackToLibrary } from './components/BackToLibrary.tsx'
import { LibraryThumb } from './components/LibraryThumb.tsx'
import { useToast } from './components/useToast.tsx'
import { categoryLabel, formatBytes, formatDuration, formatGrams, plural, relativeDate } from './model/format.ts'
import {
  confirmMatch, getOverview, listDuplicates, listMatches, listModels, rejectMatch, syncPrintHistory,
} from './service.ts'

export default function ReviewPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'duplicates' ? 'duplicates' : 'matches'
  return (
    <Stack spacing={2} sx={{ p: { xs: 1.5, md: 0 }, maxWidth: 1100 }}>
      <BackToLibrary />
      <Stack spacing={0.5}>
        <Typography variant="h1" component="h1">Review</Typography>
        <Typography color="text.secondary">
          Confirm which model each printer job was, and look at models that share the same geometry.
        </Typography>
      </Stack>
      <Tabs value={tab} onChange={(_e, next: string) => setParams(next === 'matches' ? {} : { tab: next })}>
        <Tab value="matches" label="Print matches" />
        <Tab value="duplicates" label="Same geometry" />
      </Tabs>
      {tab === 'matches' ? <Matches /> : <Duplicates />}
    </Stack>
  )
}

function Matches() {
  const toast = useToast()
  const [items, setItems] = useState<LibraryPrint[] | null>(null)
  const [canSync, setCanSync] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    const [matches, overview] = await Promise.all([listMatches(), getOverview()])
    setItems(matches)
    setCanSync(overview.printHistory.available)
  }, [])
  useEffect(() => { void load().catch(() => setItems([])) }, [load])

  const sync = async () => {
    setSyncing(true)
    try {
      const r = await syncPrintHistory()
      toast.success(`${plural(r.imported, 'print')} checked · ${r.auto} linked automatically · ${r.suggested} to review`)
      await load()
    } catch (cause) {
      toast.failure('Print history sync failed', cause)
    } finally {
      setSyncing(false)
    }
  }

  const resolve = async (print: LibraryPrint, action: 'confirm' | 'reject', modelId?: string) => {
    try {
      if (action === 'confirm') await confirmMatch(print.id, modelId)
      else await rejectMatch(print.id)
      setItems(current => current?.filter(p => p.id !== print.id) ?? null)
    } catch (cause) {
      toast.failure('Could not save', cause)
    }
  }

  return (
    <Stack spacing={1.5}>
      {canSync ? (
        <Alert severity="info" action={(
          <Button color="inherit" size="small" startIcon={<SyncRoundedIcon />} disabled={syncing} onClick={() => void sync()}>
            {syncing ? 'Syncing…' : 'Sync print history'}
          </Button>
        )}>
          Prints come from the printer's job history in EL-ement Statistics. Each Mac sync checks it too.
        </Alert>
      ) : (
        <Alert severity="info">
          Printer history belongs to the household printer, so only an administrator's Library links it. Prints you
          log by hand on a model page still count.
        </Alert>
      )}
      {items === null ? (
        <LoadingState label="Loading…" fill={false} />
      ) : items.length === 0 ? (
        <EmptyState title="Nothing to review" description="Prints whose names match a model exactly are linked automatically. Close calls show up here." />
      ) : (
        <Stack spacing={1} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {items.map(print => <MatchRow key={print.id} print={print} onResolve={resolve} />)}
        </Stack>
      )}
      {toast.element}
    </Stack>
  )
}

function MatchRow({ print, onResolve }: {
  print: LibraryPrint
  onResolve: (p: LibraryPrint, a: 'confirm' | 'reject', modelId?: string) => void
}) {
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<LibraryModel[]>([])
  const [choice, setChoice] = useState<LibraryModel | null>(null)
  const suggested = print.modelId && print.matchState === 'suggested'

  useEffect(() => {
    if (search.trim().length < 2) return
    const t = setTimeout(() => {
      listModels({ q: search.trim(), limit: 8 }).then(r => setOptions(r.items)).catch(() => undefined)
    }, 200)
    return () => clearTimeout(t)
  }, [search])

  return (
    <Paper component="li" variant="outlined" sx={{ p: 1.5, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr auto' }, alignItems: 'center' }}>
      <Stack spacing={0.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Chip size="small" variant="outlined" color={print.result === 'completed' ? 'success' : 'error'}
            label={print.result === 'completed' ? 'Printed' : 'Failed'} />
          <Typography sx={{ fontWeight: 600 }}>{print.title ?? 'Untitled job'}</Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {relativeDate(print.startedAt)} · {formatDuration(print.seconds)} · {formatGrams(print.grams)}
        </Typography>
      </Stack>
      {suggested ? (
        <Box component={Link} to={`/library/${print.modelId}`} sx={{ display: 'flex', gap: 1, alignItems: 'center', color: 'inherit', textDecoration: 'none' }}>
          <Box sx={{ width: 48, height: 48, flex: '0 0 48px', borderRadius: 1, overflow: 'hidden' }}>
            <LibraryThumb hash={print.modelThumb ?? null} iconSize={20} />
          </Box>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{print.modelTitle}</Typography>
            <Typography variant="caption" color="text.secondary">{Math.round((print.matchScore ?? 0) * 100)}% name match</Typography>
          </Box>
        </Box>
      ) : (
        <Autocomplete
          size="small" options={options} value={choice}
          getOptionLabel={m => `${m.title} (${categoryLabel(m.category)})`}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          filterOptions={x => x}
          onChange={(_e, value) => setChoice(value)}
          onInputChange={(_e, value) => setSearch(value)}
          renderInput={params => <TextField {...params} placeholder="Find the model…" slotProps={{ htmlInput: { ...params.inputProps, 'aria-label': 'Find the model' } }} />}
        />
      )}
      <Stack direction="row" spacing={1}>
        <Button variant="contained" size="small" startIcon={<CheckRoundedIcon />} disabled={!choice && !suggested}
          onClick={() => onResolve(print, 'confirm', choice?.id)}>
          {suggested ? 'Yes, that one' : 'Link'}
        </Button>
        <Button size="small" startIcon={<CloseRoundedIcon />} onClick={() => onResolve(print, 'reject')}>Not in library</Button>
      </Stack>
    </Paper>
  )
}

function Duplicates() {
  const [groups, setGroups] = useState<LibraryDuplicateGroup[] | null>(null)
  useEffect(() => { listDuplicates().then(setGroups).catch(() => setGroups([])) }, [])

  if (groups === null) return <LoadingState label="Loading…" fill={false} />
  if (!groups.length) {
    return <EmptyState title="No shared geometry" description="Exact copies are cleaned up during organizing. Different files with identical meshes would show up here." />
  }
  return (
    <Stack spacing={1.5}>
      {groups.map(group => (
        <Paper key={group.geomHash} variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Same mesh in {plural(new Set(group.files.map(f => f.modelId)).size, 'model')}
          </Typography>
          <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            {group.files.map(file => (
              <Card key={file.id} variant="outlined">
                <CardActionArea component={Link} to={`/library/${file.modelId}`} sx={{ p: 1 }}>
                  <Box sx={{ aspectRatio: '4 / 3', borderRadius: 1, overflow: 'hidden', mb: 1 }}>
                    <LibraryThumb hash={file.thumbHash ?? file.modelThumb} iconSize={24} />
                  </Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{file.title}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                    {categoryLabel(file.category)} · {file.filename} · {formatBytes(file.size)}
                  </Typography>
                </CardActionArea>
              </Card>
            ))}
          </Box>
        </Paper>
      ))}
    </Stack>
  )
}
