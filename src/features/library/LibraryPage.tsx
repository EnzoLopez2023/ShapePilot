// The model Library: every 3D print file on the owner's Mac, one card per
// model folder.
//
// The files never leave the Mac. The organizer there (tools/library-scanner)
// syncs each folder's model.json and its files' metadata; this page searches
// and filters that index. Anything that moves a file -- filing into a
// category, organizing downloads -- goes back through the helper on the Mac.
//
// Moved here from Workshop, because it is about print files and the printer's
// history, which is what this app already knows.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert, AlertTitle, Box, Button, Chip, InputAdornment, MenuItem, Paper, Stack, TextField, Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import FilterAltRoundedIcon from '@mui/icons-material/FilterAltRounded'
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded'
import InboxRoundedIcon from '@mui/icons-material/InboxRounded'
import LaptopMacRoundedIcon from '@mui/icons-material/LaptopMacRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import { LIBRARY_STATUS_LABELS } from '../../../lib/contracts/library.ts'
import type { LibraryCollection, LibraryModel, LibraryModelQuery, LibraryOverview } from '../../../lib/contracts/library.ts'
import { EmptyState, ErrorState, LoadingState } from '../../components/LoadingState.tsx'
import { errorMessage } from '../../services/errors.ts'
import { ModelCard } from './components/ModelCard.tsx'
import type { ModelCardChange } from './components/ModelCard.tsx'
import { useToast } from './components/useToast.tsx'
import { STATUS_ORDER, categoryLabel, plural, relativeDate } from './model/format.ts'
import {
  DEFAULT_FILTERS, FORMAT_OPTIONS, SORT_OPTIONS, filtersForCollection, filtersMatchSmart, filtersQuery, readFilters, writeFilters,
} from './model/filters.ts'
import type { LibraryFilters } from './model/filters.ts'
import { createCollection, getOverview, listCollections, listModels, updateModel } from './service.ts'

const PAGE_SIZE = 60

function Shortcut({ to, icon, label, count }: { to: string; icon: React.ReactNode; label: string; count: number }) {
  return (
    <Button component={Link} to={to} variant="outlined" startIcon={icon} sx={{ justifyContent: 'flex-start' }}>
      <Box component="span" sx={{ flex: 1, textAlign: 'left' }}>{label}</Box>
      <Box component="span" sx={{ ml: 1.5, fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}>{count}</Box>
    </Button>
  )
}

export default function LibraryPage() {
  const [filters, setFilters] = useState<LibraryFilters>(readFilters)
  const [debounced, setDebounced] = useState(filters.search.trim())
  const [overview, setOverview] = useState<LibraryOverview | null>(null)
  const [models, setModels] = useState<LibraryModel[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [collections, setCollections] = useState<LibraryCollection[] | null>(null)
  const [viewName, setViewName] = useState<string | null>(null)
  const toast = useToast()

  const patch = (next: Partial<LibraryFilters>) => setFilters(current => ({ ...current, ...next }))
  const apply = (next: LibraryFilters) => {
    setFilters(next)
    setDebounced(next.search.trim())
  }

  useEffect(() => { writeFilters(filters) }, [filters])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(filters.search.trim()), 200)
    return () => clearTimeout(t)
  }, [filters.search])

  const loadCollections = useCallback(() => {
    listCollections().then(setCollections).catch(() => setCollections([]))
  }, [])
  useEffect(loadCollections, [loadCollections])

  const { status, category, format, sort, favorite, collection } = filters
  const query = useMemo<LibraryModelQuery>(
    () => ({ ...filtersQuery({ search: debounced, status, category, format, sort, favorite, collection }), limit: PAGE_SIZE }),
    [debounced, status, category, format, sort, favorite, collection],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextOverview, page] = await Promise.all([getOverview(), listModels(query)])
      setOverview(nextOverview)
      setModels(page.items)
      setTotal(page.total)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [query])
  useEffect(() => { void load() }, [load])

  // A remembered collection or category can vanish (deleted, renamed, emptied).
  useEffect(() => {
    if (collection !== null && collections && !collections.some(c => c.id === collection)) patch({ collection: null })
  }, [collection, collections])
  useEffect(() => {
    if (category && overview && !overview.byCategory.some(c => c.category === category)) patch({ category: '' })
  }, [category, overview])

  // A change from a card shows at once and is saved behind it; a failed save puts the card back.
  const changeModel = async (model: LibraryModel, change: ModelCardChange) => {
    const swap = (next: LibraryModel) => setModels(current => current.map(m => (m.id === next.id ? next : m)))
    swap({ ...model, ...change })
    try {
      swap(await updateModel(model.id, change))
      if (favorite && 'favorite' in change && change.favorite === false) await load()
      if ('status' in change) getOverview().then(setOverview).catch(() => undefined)
    } catch (cause) {
      swap(model)
      toast.failure('status' in change ? 'Could not change the status' : 'Could not update the favorite', cause)
    }
  }

  const loadMore = async () => {
    try {
      const page = await listModels({ ...query, offset: models.length })
      setModels(current => [...current, ...page.items])
    } catch (cause) {
      toast.failure('Could not load more models', cause)
    }
  }

  const saveView = async () => {
    const name = viewName?.trim()
    if (!name) return
    try {
      await createCollection({
        name,
        kind: 'smart',
        query: {
          q: filters.search.trim() || undefined, status: status || undefined, category: category || undefined,
          format: format || undefined, sort, ...(favorite ? { favorite: true } : {}),
        },
      })
      toast.success(`Saved “${name}”`)
      setViewName(null)
      loadCollections()
    } catch (cause) {
      toast.failure('Could not save the view', cause)
    }
  }

  const counts = overview?.byStatus ?? {}
  const allCount = Object.values(counts).reduce((n, v) => n + (v ?? 0), 0)
  const pending = overview?.planSummary?.pending ?? 0
  const filtered = Boolean(filters.search.trim() || status || category || format || favorite || sort !== 'recent')

  return (
    <Stack spacing={2} sx={{ p: { xs: 1.5, md: 0 }, maxWidth: 1400 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap', rowGap: 0.5 }}>
        <Typography variant="h1" component="h1">Library</Typography>
        <Typography color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {loading ? '' : plural(total, 'model')}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {overview?.lastSync && (
          <Typography variant="body2" color="text.secondary">
            Synced {relativeDate(overview.lastSync.at).toLowerCase()} from {overview.lastSync.device}
          </Typography>
        )}
      </Stack>

      {overview && !overview.lastSync && (
        <Alert
          severity="info"
          icon={<LaptopMacRoundedIcon />}
          action={<Button component={Link} to="/settings#library" color="inherit" size="small">Set up</Button>}
        >
          <AlertTitle>Connect the Mac that holds your print files</AlertTitle>
          The Library indexes STL and 3MF files where they live in OneDrive. Create a device token in Settings, then run
          {' '}<code>npm run library -- connect &lt;token&gt;</code> and <code>npm run library -- install</code> on the Mac.
        </Alert>
      )}

      {pending > 0 && (
        <Alert
          severity="warning"
          action={(
            <Button component={Link} to="/library/organize" color="inherit" size="small" endIcon={<ArrowForwardRoundedIcon />}>
              Review
            </Button>
          )}
        >
          <AlertTitle>{plural(pending, 'model')} waiting to be organized</AlertTitle>
          Review where each one goes, what it is called, and which duplicate copies go to the Trash.
          Nothing moves until you approve it.
        </Alert>
      )}

      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, maxWidth: 720 }}>
        <Shortcut to="/library/inbox" icon={<InboxRoundedIcon />} label="Triage inbox" count={counts.inbox ?? 0} />
        <Shortcut to="/library/review" icon={<AutoAwesomeRoundedIcon />} label="Print matches" count={overview?.suggestions ?? 0} />
        <Shortcut to="/library/review?tab=duplicates" icon={<LinkRoundedIcon />} label="Same geometry" count={overview?.duplicateGroups ?? 0} />
      </Box>

      <Stack direction="row" spacing={1} role="group" aria-label="Collections" sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="overline" color="text.secondary">Collections</Typography>
        {collections?.map(c => {
          const active = c.kind === 'manual' ? collection === c.id : filtersMatchSmart(filters, c)
          return (
            <Chip
              key={c.id}
              icon={c.kind === 'smart' ? <FilterAltRoundedIcon /> : undefined}
              label={`${c.name} · ${c.count}`}
              color={active ? 'primary' : 'default'}
              variant={active ? 'filled' : 'outlined'}
              aria-pressed={active}
              title={c.kind === 'smart' ? 'Smart collection: saved filters' : undefined}
              onClick={() => {
                if (!active) apply(filtersForCollection(c))
                else if (c.kind === 'manual') patch({ collection: null })
                else apply(DEFAULT_FILTERS)
              }}
            />
          )
        })}
        {collections?.length === 0 && (
          <Typography variant="body2" color="text.secondary">None yet. Add models from a model page, or save a filtered view.</Typography>
        )}
        {viewName !== null ? (
          <Stack direction="row" spacing={1} component="form" onSubmit={e => { e.preventDefault(); void saveView() }}>
            <TextField
              autoFocus size="small" value={viewName} placeholder="Name this view"
              slotProps={{ htmlInput: { maxLength: 80, 'aria-label': 'Smart collection name' } }}
              onChange={e => setViewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setViewName(null) }}
            />
            <Button type="submit" variant="contained" size="small" disabled={!viewName.trim()}>Save</Button>
            <Button size="small" onClick={() => setViewName(null)}>Cancel</Button>
          </Stack>
        ) : filtered && collection === null && (
          <Chip icon={<AddRoundedIcon />} label="Save this view" variant="outlined" onClick={() => setViewName('')} />
        )}
        <Button component={Link} to="/library/manage" size="small" startIcon={<SettingsRoundedIcon />}>Manage</Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack spacing={1.5}>
          <TextField
            size="small" fullWidth value={filters.search}
            placeholder="Search titles, designers, tags, filenames, notes"
            onChange={e => patch({ search: e.target.value })}
            slotProps={{
              htmlInput: { 'aria-label': 'Search the library' },
              input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon /></InputAdornment> },
            }}
          />
          <Stack direction="row" spacing={0.75} role="group" aria-label="Status" sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>
            <Chip
              label={`All · ${allCount}`} color={status === '' ? 'primary' : 'default'}
              variant={status === '' ? 'filled' : 'outlined'} aria-pressed={status === ''}
              onClick={() => patch({ status: '' })}
            />
            {STATUS_ORDER.map(key => (
              <Chip
                key={key} label={`${LIBRARY_STATUS_LABELS[key]} · ${counts[key] ?? 0}`}
                color={status === key ? 'primary' : 'default'} variant={status === key ? 'filled' : 'outlined'}
                aria-pressed={status === key} onClick={() => patch({ status: key })}
              />
            ))}
            <Chip
              icon={<FavoriteRoundedIcon />} label="Favorites"
              color={favorite ? 'primary' : 'default'} variant={favorite ? 'filled' : 'outlined'}
              aria-pressed={favorite} onClick={() => patch({ favorite: !favorite })}
            />
          </Stack>
          <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 220px))' } }}>
            <TextField select size="small" label="Category" value={category} onChange={e => patch({ category: e.target.value })}
              slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
              <MenuItem value="">All categories</MenuItem>
              {overview?.byCategory.map(c => (
                <MenuItem key={c.category} value={c.category}>{categoryLabel(c.category)} ({c.count})</MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="Format" value={format} onChange={e => patch({ format: e.target.value })}
              slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
              {FORMAT_OPTIONS.map(f => <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Sort" value={sort} onChange={e => patch({ sort: e.target.value as LibraryFilters['sort'] })}>
              {SORT_OPTIONS.map(s => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
            </TextField>
          </Box>
        </Stack>
      </Paper>

      {error ? (
        <ErrorState title="Library unavailable" message={error} onRetry={() => void load()} />
      ) : loading ? (
        <LoadingState label="Loading the library…" fill={false} />
      ) : models.length === 0 ? (
        <EmptyState
          title={allCount === 0 ? 'No models yet' : 'No matching models'}
          description={allCount === 0
            ? pending > 0
              ? 'Your files have been found but not organized yet. Review the plan to file them into the library.'
              : 'Once your Mac syncs, every organized model folder appears here.'
            : 'Change the search or filters to bring models back into view.'}
          action={allCount === 0 && pending > 0
            ? <Button component={Link} to="/library/organize" variant="contained">Review the plan</Button>
            : undefined}
        />
      ) : (
        <>
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {models.map(model => <ModelCard key={model.id} model={model} onChange={change => void changeModel(model, change)} />)}
          </Box>
          {models.length < total && (
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <Button variant="outlined" onClick={() => void loadMore()}>Show more ({total - models.length} left)</Button>
            </Box>
          )}
        </>
      )}
      {toast.element}
    </Stack>
  )
}
