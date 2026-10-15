// Categories and collections. Categories are the folders models live in on
// the Mac, so changing one goes through the helper there and is undoable.
// Collections group models across categories without moving any files.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, AlertTitle, Box, Button, Divider, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import FilterAltRoundedIcon from '@mui/icons-material/FilterAltRounded'
import { LIBRARY_STATUS_LABELS } from '../../../lib/contracts/library.ts'
import type { LibraryCollection } from '../../../lib/contracts/library.ts'
import { useConfirm } from '../../components/ConfirmDialogProvider.tsx'
import { EmptyState, LoadingState } from '../../components/LoadingState.tsx'
import { BackToLibrary } from './components/BackToLibrary.tsx'
import { useToast } from './components/useToast.tsx'
import { categoryLabel, plural } from './model/format.ts'
import { FORMAT_OPTIONS, SORT_OPTIONS, filtersForCollection, followCategory, writeFilters } from './model/filters.ts'
import { HELPER_CATEGORY_VERSION, HELPER_RESTART, libraryHelper, useLibraryHelper } from './model/helper.ts'
import type { HelperCategory } from './model/helper.ts'
import { createCollection, deleteCollection, getOverview, listCollections, renameCollection } from './service.ts'

type Toast = ReturnType<typeof useToast>

export default function ManagePage() {
  const toast = useToast()
  return (
    <Stack spacing={3} sx={{ p: { xs: 1.5, md: 0 }, maxWidth: 900 }}>
      <BackToLibrary />
      <Stack spacing={0.5}>
        <Typography variant="h1" component="h1">Categories & collections</Typography>
        <Typography color="text.secondary">
          Categories are the folders your models live in on your Mac. Collections group models across categories
          without moving any files.
        </Typography>
      </Stack>
      <Categories toast={toast} />
      <Collections toast={toast} />
      {toast.element}
    </Stack>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <Stack direction="row" spacing={1} sx={{ alignItems: 'center', p: 1.25, flexWrap: 'wrap', rowGap: 1 }}>{children}</Stack>
}

function Categories({ toast }: { toast: Toast }) {
  const helper = useLibraryHelper()
  const capable = helper.available && (helper.health?.version ?? 0) >= HELPER_CATEGORY_VERSION
  const [details, setDetails] = useState<HelperCategory[] | null>(null)
  const [synced, setSynced] = useState<{ category: string; count: number }[] | null>(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (capable) libraryHelper.categories().then(r => setDetails(r.details ?? [])).catch(() => setDetails([]))
    else getOverview().then(o => setSynced(o.byCategory)).catch(() => setSynced([]))
  }, [capable])
  useEffect(load, [load])

  /** Runs a helper change, then offers Undo (every category change is logged on the Mac). */
  const run = async (job: () => Promise<{ batch: string | null }>, success: string, after?: () => void) => {
    setBusy(true)
    try {
      const { batch } = await job()
      after?.()
      toast.success(success, batch ? {
        label: 'Undo',
        onClick: () => {
          libraryHelper.undo(batch).then(() => { toast.success('Undone'); load() }).catch(err => toast.failure('Undo failed', err))
        },
      } : undefined)
      load()
    } catch (cause) {
      toast.failure('Category change failed', cause)
    } finally {
      setBusy(false)
    }
  }

  const synchronized = (
    synced === null ? <LoadingState label="Loading categories…" fill={false} />
      : synced.length === 0 ? <EmptyState title="No categories yet" description="Categories appear once your Mac syncs organized models." />
        : (
          <Paper variant="outlined">
            {synced.map((c, i) => (
              <Box key={c.category}>
                {i > 0 && <Divider />}
                <Row>
                  <Typography sx={{ fontWeight: 600, flex: 1 }}>{categoryLabel(c.category)}</Typography>
                  <Typography variant="body2" color="text.secondary">{plural(c.count, 'model')}</Typography>
                </Row>
              </Box>
            ))}
          </Paper>
        )
  )

  return (
    <Stack spacing={1.5} component="section" aria-labelledby="manage-categories">
      <Typography id="manage-categories" variant="h2" component="h2" sx={{ fontSize: '1.15rem' }}>Categories</Typography>
      {helper.checking ? (
        <LoadingState label="Looking for the Library helper on this Mac…" fill={false} />
      ) : !helper.available ? (
        <>
          <Typography variant="body2" color="text.secondary">
            Renaming or merging a category moves folders on the Mac that holds your library, so it works there while
            the Library helper is running. Here is what the Library last synced:
          </Typography>
          {synchronized}
        </>
      ) : !capable ? (
        <>
          <Alert severity="warning" action={<Button color="inherit" size="small" onClick={helper.recheck}>Check again</Button>}>
            <AlertTitle>Restart the Library helper to manage categories</AlertTitle>
            The helper running on this Mac predates category management. Restart it in Terminal, then check again:
            <Box component="code" sx={{ display: 'block', mt: 1, fontSize: 12 }}>{HELPER_RESTART}</Box>
          </Alert>
          {synchronized}
        </>
      ) : details === null ? (
        <LoadingState label="Loading categories…" fill={false} />
      ) : (
        <>
          <Paper variant="outlined">
            {details.map((category, i) => (
              <Box key={category.name}>
                {i > 0 && <Divider />}
                <CategoryRow category={category} all={details} busy={busy} run={run} />
              </Box>
            ))}
          </Paper>
          <Stack direction="row" spacing={1} component="form"
            onSubmit={e => {
              e.preventDefault()
              const name = newName.trim()
              if (name) void run(() => libraryHelper.createCategory(name), `Created ${name}`, () => setNewName(''))
            }}>
            <TextField size="small" value={newName} placeholder="New category name" sx={{ flex: 1, maxWidth: 360 }}
              slotProps={{ htmlInput: { maxLength: 120, 'aria-label': 'New category name' } }}
              onChange={e => setNewName(e.target.value)} />
            <Button type="submit" variant="outlined" startIcon={<CreateNewFolderRoundedIcon />} disabled={!newName.trim() || busy}>
              Create category
            </Button>
          </Stack>
        </>
      )}
    </Stack>
  )
}

type Run = (job: () => Promise<{ batch: string | null }>, success: string, after?: () => void) => Promise<void>

function CategoryRow({ category, all, busy, run }: { category: HelperCategory; all: HelperCategory[]; busy: boolean; run: Run }) {
  const [mode, setMode] = useState<'view' | 'rename' | 'merge'>('view')
  const [name, setName] = useState(category.name)
  const [into, setInto] = useState('')
  const targets = all.filter(c => c.name !== category.name)
  const models = plural(category.models, 'model')

  if (mode === 'rename') {
    return (
      <Row>
        <Stack direction="row" spacing={1} component="form" sx={{ flex: 1 }}
          onSubmit={e => {
            e.preventDefault()
            const to = name.trim()
            if (!to || to === category.name) return setMode('view')
            void run(() => libraryHelper.renameCategory(category.name, to), `Renamed ${category.name} to ${to}`,
              () => followCategory(category.name, to))
          }}>
          <TextField autoFocus size="small" value={name} sx={{ flex: 1 }}
            slotProps={{ htmlInput: { maxLength: 120, 'aria-label': `New name for ${category.name}` } }}
            onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setMode('view') }} />
          <Button type="submit" variant="contained" size="small" disabled={!name.trim() || busy}>Rename</Button>
          <Button size="small" onClick={() => { setName(category.name); setMode('view') }}>Cancel</Button>
        </Stack>
      </Row>
    )
  }
  return (
    <Row>
      <Box sx={{ flex: 1, minWidth: 160 }}>
        <Typography sx={{ fontWeight: 600 }}>{categoryLabel(category.name)}</Typography>
        <Typography variant="caption" color="text.secondary">{models}{category.protected ? ' · managed by the organizer' : ''}</Typography>
      </Box>
      {mode === 'merge' ? (
        <>
          <TextField select size="small" label="Merge into" value={into} sx={{ minWidth: 180 }} onChange={e => setInto(e.target.value)}>
            {targets.map(c => <MenuItem key={c.name} value={c.name}>{categoryLabel(c.name)}</MenuItem>)}
          </TextField>
          <Button variant="contained" size="small" disabled={!into || busy}
            onClick={() => void run(() => libraryHelper.mergeCategory(category.name, into),
              `Moved ${models} from ${category.name} into ${categoryLabel(into)}`, () => followCategory(category.name, into))}>
            Merge
          </Button>
          <Button size="small" onClick={() => { setInto(''); setMode('view') }}>Cancel</Button>
        </>
      ) : !category.protected && (
        <>
          <Button size="small" disabled={busy} onClick={() => setMode('rename')}>Rename</Button>
          {targets.length > 0 && <Button size="small" disabled={busy} onClick={() => setMode('merge')}>Merge…</Button>}
          {category.models === 0 && (
            <Button size="small" color="error" disabled={busy}
              onClick={() => void run(() => libraryHelper.deleteCategory(category.name), `Removed ${category.name}`,
                () => followCategory(category.name, ''))}>
              Remove
            </Button>
          )}
        </>
      )}
    </Row>
  )
}

function describeSmart(collection: LibraryCollection): string {
  const q = collection.query ?? {}
  const parts = [
    q.q && `“${q.q}”`,
    q.status && LIBRARY_STATUS_LABELS[q.status],
    q.category && categoryLabel(q.category),
    q.format && FORMAT_OPTIONS.find(f => f.value === q.format)?.label,
    q.sort && q.sort !== 'recent' && SORT_OPTIONS.find(s => s.value === q.sort)?.label,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Every model'
}

function Collections({ toast }: { toast: Toast }) {
  const navigate = useNavigate()
  const [collections, setCollections] = useState<LibraryCollection[] | null>(null)
  const [newName, setNewName] = useState('')

  const load = useCallback(() => {
    listCollections().then(setCollections).catch(() => setCollections([]))
  }, [])
  useEffect(load, [load])

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      await createCollection({ name, kind: 'manual' })
      setNewName('')
      load()
    } catch (cause) {
      toast.failure('Could not create the collection', cause)
    }
  }

  const open = (collection: LibraryCollection) => {
    writeFilters(filtersForCollection(collection))
    navigate('/library')
  }

  return (
    <Stack spacing={1.5} component="section" aria-labelledby="manage-collections">
      <Typography id="manage-collections" variant="h2" component="h2" sx={{ fontSize: '1.15rem' }}>Collections</Typography>
      <Typography variant="body2" color="text.secondary">
        Add models to a collection from their page. Smart collections are saved Library filters: set the filters in
        the Library, then choose <strong>Save this view</strong>.
      </Typography>
      {collections === null ? (
        <LoadingState label="Loading collections…" fill={false} />
      ) : collections.length > 0 && (
        <Paper variant="outlined">
          {collections.map((c, i) => (
            <Box key={c.id}>
              {i > 0 && <Divider />}
              <CollectionRow collection={c} onOpen={() => open(c)} onChanged={load} toast={toast} />
            </Box>
          ))}
        </Paper>
      )}
      <Stack direction="row" spacing={1} component="form" onSubmit={e => { e.preventDefault(); void create() }}>
        <TextField size="small" value={newName} placeholder="New collection name" sx={{ flex: 1, maxWidth: 360 }}
          slotProps={{ htmlInput: { maxLength: 80, 'aria-label': 'New collection name' } }}
          onChange={e => setNewName(e.target.value)} />
        <Button type="submit" variant="outlined" startIcon={<AddRoundedIcon />} disabled={!newName.trim()}>Create collection</Button>
      </Stack>
    </Stack>
  )
}

function CollectionRow({ collection, onOpen, onChanged, toast }: {
  collection: LibraryCollection
  onOpen: () => void
  onChanged: () => void
  toast: Toast
}) {
  const confirm = useConfirm()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(collection.name)

  const rename = async () => {
    const to = name.trim()
    if (!to || to === collection.name) return setRenaming(false)
    try {
      await renameCollection(collection.id, to)
      setRenaming(false)
      onChanged()
    } catch (cause) {
      toast.failure('Could not rename the collection', cause)
    }
  }

  const remove = async () => {
    const ok = await confirm({
      title: `Delete “${collection.name}”?`,
      message: 'Its models stay in the Library.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteCollection(collection.id)
      toast.success(`Deleted ${collection.name}`)
      onChanged()
    } catch (cause) {
      toast.failure('Could not delete the collection', cause)
    }
  }

  if (renaming) {
    return (
      <Row>
        <Stack direction="row" spacing={1} component="form" sx={{ flex: 1 }} onSubmit={e => { e.preventDefault(); void rename() }}>
          <TextField autoFocus size="small" value={name} sx={{ flex: 1 }}
            slotProps={{ htmlInput: { maxLength: 80, 'aria-label': `New name for ${collection.name}` } }}
            onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setRenaming(false) }} />
          <Button type="submit" variant="contained" size="small" disabled={!name.trim()}>Rename</Button>
          <Button size="small" onClick={() => { setName(collection.name); setRenaming(false) }}>Cancel</Button>
        </Stack>
      </Row>
    )
  }
  return (
    <Row>
      <Button onClick={onOpen} sx={{ flex: 1, justifyContent: 'flex-start', textAlign: 'left', textTransform: 'none', color: 'text.primary' }}>
        <Box>
          <Typography sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {collection.kind === 'smart' && <FilterAltRoundedIcon fontSize="inherit" />} {collection.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {plural(collection.count, 'model')} · {collection.kind === 'smart' ? describeSmart(collection) : 'Chosen models'}
          </Typography>
        </Box>
      </Button>
      <Button size="small" onClick={() => setRenaming(true)}>Rename</Button>
      <Button size="small" color="error" onClick={() => void remove()}>Delete</Button>
    </Row>
  )
}
