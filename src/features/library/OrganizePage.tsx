// Organize: the organizer's plan for the files on the Mac, approved here.
//
// Every model gets its own folder inside a category, downloads go to Inbox,
// and exact duplicate copies go to the Trash. The plan is computed on the Mac
// and synced up; nothing moves until it is approved, and applying it needs the
// helper on that Mac. Every batch is undoable.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Chip, Divider, Paper, Stack, Typography,
} from '@mui/material'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DriveFileMoveRoundedIcon from '@mui/icons-material/DriveFileMoveRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import UndoRoundedIcon from '@mui/icons-material/UndoRounded'
import { LIBRARY_STATUS_LABELS } from '../../../lib/contracts/library.ts'
import type { LibraryBatch, LibraryPlan, LibraryPlanModel } from '../../../lib/contracts/library.ts'
import { useConfirm } from '../../components/ConfirmDialogProvider.tsx'
import { EmptyState, LoadingState } from '../../components/LoadingState.tsx'
import { BackToLibrary } from './components/BackToLibrary.tsx'
import { LibraryThumb } from './components/LibraryThumb.tsx'
import { useToast } from './components/useToast.tsx'
import { STATUS_COLOR, categoryLabel, formatBytes, plural, relativeDate } from './model/format.ts'
import { libraryHelper, useLibraryHelper } from './model/helper.ts'
import { getOverview, getPlan } from './service.ts'

const BATCH_LABELS: Record<string, string> = {
  intake: 'Filed downloads',
  migrate: 'Organized',
  file: 'Moved a model',
  edit: 'Saved edits',
  trash: 'Trashed a file',
  category: 'Changed a category',
}

function Summary({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</Typography>
      <Typography sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{value ?? '—'}</Typography>
    </Box>
  )
}

export default function OrganizePage() {
  const helper = useLibraryHelper()
  const confirm = useConfirm()
  const toast = useToast()
  const [plan, setPlan] = useState<LibraryPlan | null | undefined>(undefined)
  const [batches, setBatches] = useState<LibraryBatch[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [working, setWorking] = useState<string | null>(null)

  const refreshBatches = useCallback(() => {
    libraryHelper.batches().then(r => setBatches(r.batches)).catch(() => undefined)
  }, [])

  const load = useCallback(async () => {
    const [nextPlan, overview] = await Promise.all([getPlan(), getOverview()])
    setPlan(nextPlan)
    setBatches(overview.batches)
    setSelected(new Set())
  }, [])
  useEffect(() => { void load().catch(() => setPlan(null)) }, [load])
  useEffect(() => { if (helper.available) refreshBatches() }, [helper.available, refreshBatches])

  const groups = useMemo(() => {
    const map = new Map<string, LibraryPlanModel[]>()
    for (const m of plan?.models ?? []) {
      const key = m.dest ? m.category : 'Duplicates only'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    }
    return [...map.entries()].sort((a, b) => categoryLabel(a[0]).localeCompare(categoryLabel(b[0])))
  }, [plan])

  const toggle = (ids: string[], on: boolean) => setSelected(current => {
    const next = new Set(current)
    for (const id of ids) {
      if (on) next.add(id)
      else next.delete(id)
    }
    return next
  })

  const undo = async (batch: string) => {
    const ok = await confirm({
      title: 'Undo this batch?',
      message: 'Every file from this batch goes back where it was.',
      confirmLabel: 'Undo',
    })
    if (!ok) return
    setWorking('Undoing…')
    try {
      const { reversed } = await libraryHelper.undo(batch)
      toast.success(`Reversed ${plural(reversed, 'operation')}`)
      await libraryHelper.sync()
      await load()
      refreshBatches()
    } catch (cause) {
      toast.failure('Undo failed', cause)
    } finally {
      setWorking(null)
    }
  }

  const rescan = async () => {
    setWorking('Rescanning your library…')
    try {
      await libraryHelper.sync()
      await load()
    } catch (cause) {
      toast.failure('Rescan failed', cause)
    } finally {
      setWorking(null)
    }
  }

  const apply = async () => {
    const ids = [...selected]
    setWorking(`Organizing ${plural(ids.length, 'model')}…`)
    try {
      const result = await libraryHelper.applyPlan(ids)
      const failed = result.results.filter(r => !r.ok)
      if (failed.length) {
        toast.show({
          severity: 'warning',
          message: `${ids.length - failed.length} organized, ${failed.length} skipped\n${failed.slice(0, 3).map(f => `${f.title}: ${f.error}`).join('\n')}`,
        })
      } else {
        toast.success(`Organized ${plural(ids.length, 'model')}`, { label: 'Undo', onClick: () => void undo(result.batch) })
      }
      setWorking('Updating the Library…')
      await libraryHelper.sync()
      await load()
      refreshBatches()
    } catch (cause) {
      toast.failure('Organizing failed', cause)
    } finally {
      setWorking(null)
    }
  }

  const s = plan?.summary
  const allIds = plan?.models.map(m => m.id) ?? []

  return (
    <Stack spacing={2} sx={{ p: { xs: 1.5, md: 0 }, maxWidth: 1100 }}>
      <BackToLibrary />
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Stack spacing={0.5} sx={{ flex: 1 }}>
          <Typography variant="h1" component="h1">Organize</Typography>
          <Typography color="text.secondary">
            Every model gets its own folder inside a category. Downloads go to Inbox. Exact duplicate copies go to the
            Trash, where you can still recover them.
          </Typography>
        </Stack>
        {helper.available && (
          <Button variant="outlined" startIcon={<RefreshRoundedIcon />} disabled={Boolean(working)} onClick={() => void rescan()}>Rescan</Button>
        )}
      </Stack>

      {!helper.available && !helper.checking && (
        <Alert severity="info">
          The plan below is read-only here. Applying it needs the Library helper, which runs on the Mac that holds the
          files — open this page there.
        </Alert>
      )}

      {plan === undefined ? (
        <LoadingState label="Loading the plan…" fill={false} />
      ) : !plan || plan.models.length === 0 ? (
        <EmptyState title="Everything is organized" description="New downloads are filed into Inbox automatically. Nothing is waiting here." />
      ) : (
        <>
          <Paper variant="outlined" sx={{ p: 1.5, display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
            <Summary label="Models" value={s?.models} />
            <Summary label="File moves" value={s?.moves} />
            <Summary label="From ZIPs" value={s?.extracts} />
            <Summary label="Duplicates → Trash" value={s ? `${s.trash} · ${formatBytes(s.trashBytes)}` : undefined} />
            <Summary label="Planned" value={relativeDate(plan.createdAt)} />
          </Paper>

          <Paper variant="outlined" sx={{ p: 1, position: 'sticky', top: 8, zIndex: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography role="status" variant="body2" sx={{ flex: 1, px: 1 }}>
              {working ?? `${selected.size} of ${plan.models.length} selected`}
            </Typography>
            <Button size="small" onClick={() => toggle(allIds, selected.size < allIds.length)}>
              {selected.size < allIds.length ? 'Select all' : 'Select none'}
            </Button>
            <Button variant="contained" size="small" startIcon={<DriveFileMoveRoundedIcon />}
              disabled={!helper.available || !selected.size || Boolean(working)} onClick={() => void apply()}>
              Organize selected
            </Button>
          </Paper>

          {groups.map(([category, models]) => {
            const ids = models.map(m => m.id)
            const allOn = ids.every(id => selected.has(id))
            return (
              <Stack key={category} spacing={1} component="section">
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  {category === 'Duplicates only' ? <DeleteOutlineRoundedIcon fontSize="small" /> : <DriveFileMoveRoundedIcon fontSize="small" />}
                  <Typography variant="h2" component="h2" sx={{ fontSize: '1.05rem', flex: 1 }}>
                    {categoryLabel(category)} <Typography component="span" color="text.secondary">{models.length}</Typography>
                  </Typography>
                  <Button size="small" onClick={() => toggle(ids, !allOn)}>{allOn ? 'Clear' : 'Select group'}</Button>
                </Stack>
                <Paper variant="outlined">
                  {models.map((m, i) => (
                    <Box key={m.id}>
                      {i > 0 && <Divider />}
                      <Stack direction="row" spacing={1.5} component="label" sx={{ alignItems: 'center', p: 1, cursor: 'pointer' }}>
                        <Checkbox checked={selected.has(m.id)} onChange={e => toggle([m.id], e.target.checked)} />
                        <Box sx={{ width: 48, height: 48, flex: '0 0 48px', borderRadius: 1, overflow: 'hidden' }}>
                          <LibraryThumb hash={m.thumb} iconSize={20} />
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{m.title}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                            {m.origin === 'intake' ? 'From ' : 'In '}{m.sourceLabel}
                            {m.dest && <><ArrowForwardRoundedIcon sx={{ fontSize: 12 }} /> {m.dest.replace(/^_(Inbox|Archive)\//, '$1/')}</>}
                            {m.suggestedCategory && m.suggestedCategory !== m.category && m.category === '_Inbox' && ` · looks like ${m.suggestedCategory}`}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end', rowGap: 0.5 }}>
                          <Chip size="small" variant="outlined" color={STATUS_COLOR[m.status]} label={LIBRARY_STATUS_LABELS[m.status]} />
                          {m.moveCount + m.extractCount > 0 && <Chip size="small" label={plural(m.moveCount + m.extractCount, 'file')} />}
                          {m.trashCount > 0 && <Chip size="small" color="warning" label={plural(m.trashCount, 'duplicate')} />}
                        </Stack>
                      </Stack>
                      {(m.moves.length > 0 || m.trash.length > 0) && (
                        <Box component="details" sx={{ px: 2, pb: 1 }}>
                          <Box component="summary" sx={{ cursor: 'pointer', typography: 'caption', color: 'text.secondary' }}>Details</Box>
                          <Box component="ul" sx={{ m: 0, pl: 2, typography: 'caption', fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
                            {m.moves.map(mv => <li key={mv.from}>{mv.from} → {mv.to}</li>)}
                            {m.moveCount > m.moves.length && <li>…and {m.moveCount - m.moves.length} more</li>}
                            {m.trash.map(t => <li key={t.path}>Trash: {t.path} — {t.reason}</li>)}
                          </Box>
                        </Box>
                      )}
                    </Box>
                  ))}
                </Paper>
              </Stack>
            )
          })}
        </>
      )}

      {batches.length > 0 && (
        <Stack spacing={1} component="section">
          <Typography variant="h2" component="h2" sx={{ fontSize: '1.05rem' }}>History</Typography>
          <Paper variant="outlined">
            {batches.slice(0, 20).map((b, i) => (
              <Box key={b.batch}>
                {i > 0 && <Divider />}
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', p: 1.25 }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{BATCH_LABELS[b.kind ?? ''] ?? 'Change'}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {relativeDate(b.at)} · {plural(b.ops, 'operation')}{b.undone ? ' · undone' : ''}
                    </Typography>
                  </Box>
                  {helper.available && !b.undone && b.kind !== 'edit' && (
                    <Button size="small" startIcon={<UndoRoundedIcon />} disabled={Boolean(working)} onClick={() => void undo(b.batch)}>Undo</Button>
                  )}
                </Stack>
              </Box>
            ))}
          </Paper>
        </Stack>
      )}
      {toast.element}
    </Stack>
  )
}
