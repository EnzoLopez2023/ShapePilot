import { useRef, useState } from 'react'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton,
  LinearProgress, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import UploadIcon from '@mui/icons-material/UploadFileOutlined'
import EditIcon from '@mui/icons-material/EditOutlined'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import AddIcon from '@mui/icons-material/Add'
import { LABEL_LIST_LIMITS, parseLabelFile } from '../../../../lib/contracts/gridfinity.ts'
import { useConfirm } from '../../../components/ConfirmDialogProvider.tsx'
import { EmptyState, LoadingState } from '../../../components/LoadingState.tsx'
import type { LabelList } from '../model/types.ts'
import * as api from '../service.ts'

export interface LabelListsPanelProps {
  lists: LabelList[]
  loading: boolean
  activeListId?: string
  onChanged: () => Promise<void>
  onUse: (list: LabelList) => void
  onToast: (message: string) => void
  onError: (message: string) => void
  /** Builds and zips one bin per item; reports progress as [done, total]. */
  onExportAll: (list: LabelList, progress: (done: number, total: number) => void) => Promise<void>
}

interface Editing { id?: string; name: string; text: string }

export default function LabelListsPanel(
  { lists, loading, activeListId, onChanged, onUse, onToast, onError, onExportAll }: LabelListsPanelProps,
) {
  const confirm = useConfirm()
  const fileInput = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [saving, setSaving] = useState(false)
  const [batch, setBatch] = useState<{ listId: string; done: number; total: number } | null>(null)

  const upload = async (file: File) => {
    if (file.size > LABEL_LIST_LIMITS.maxFileBytes) {
      onError(`${file.name} is larger than ${LABEL_LIST_LIMITS.maxFileBytes / 1024} KB. Split it into smaller lists.`)
      return
    }
    const { items, truncated, dropped } = parseLabelFile(await file.text())
    if (!items.length) {
      onError(`${file.name} has no labels in it. Put one label on each line and upload it again.`)
      return
    }
    const name = file.name.replace(/\.[^.]+$/, '').slice(0, LABEL_LIST_LIMITS.nameMaxLength) || 'Uploaded list'
    try {
      const { id } = await api.createLabelList(name, items)
      await onChanged()
      onUse({ id, name, items, createdAt: '', updatedAt: '' })
      const notes = [
        truncated ? `${truncated} shortened to ${LABEL_LIST_LIMITS.itemMaxLength} characters` : '',
        dropped ? `${dropped} past the ${LABEL_LIST_LIMITS.maxItems}-item limit left out` : '',
      ].filter(Boolean).join(', ')
      onToast(`Saved "${name}" with ${items.length} labels${notes ? ` (${notes})` : ''}`)
    } catch (e) { onError((e as Error).message) }
  }

  const saveEdit = async () => {
    if (!editing) return
    const { items } = parseLabelFile(editing.text)
    const name = editing.name.trim()
    if (!name) { onError('Give the list a name before saving it.'); return }
    if (!items.length) { onError('Add at least one label, one per line.'); return }
    setSaving(true)
    try {
      if (editing.id) await api.updateLabelList(editing.id, name, items)
      else await api.createLabelList(name, items)
      await onChanged()
      setEditing(null)
      onToast(editing.id ? `Updated "${name}"` : `Saved "${name}"`)
    } catch (e) { onError((e as Error).message) } finally { setSaving(false) }
  }

  const remove = async (list: LabelList) => {
    const ok = await confirm({
      title: 'Delete this label list?',
      message: `"${list.name}" and its ${list.items.length} labels will be removed. Bins already saved keep their text.`,
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    try {
      await api.deleteLabelList(list.id)
      await onChanged()
      onToast(`Deleted "${list.name}"`)
    } catch (e) { onError((e as Error).message) }
  }

  const exportAll = async (list: LabelList) => {
    setBatch({ listId: list.id, done: 0, total: list.items.length })
    try {
      await onExportAll(list, (done, total) => setBatch({ listId: list.id, done, total }))
    } catch (e) { onError((e as Error).message) } finally { setBatch(null) }
  }

  const draft = editing ? parseLabelFile(editing.text) : null
  const draftCount = draft?.items.length ?? 0

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h3" component="h2">Label lists</Typography>
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="New list">
            <IconButton size="small" aria-label="New label list" onClick={() => setEditing({ name: '', text: '' })}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button size="small" startIcon={<UploadIcon />} onClick={() => fileInput.current?.click()}>
            Upload .txt
          </Button>
        </Stack>
      </Stack>
      <input
        ref={fileInput} type="file" accept=".txt,.csv,text/plain" hidden
        onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void upload(file)
        }}
      />
      <Typography variant="body2" color="text.secondary">
        One label per line. Uploaded lists are saved to your account and show up in the label picker.
      </Typography>

      {loading && !lists.length && <LoadingState label="Loading label lists…" />}
      {!loading && !lists.length && (
        <EmptyState
          title="No label lists"
          description="Upload a text file with one label per line, or start a new list."
        />
      )}
      <Stack divider={<Divider />}>
        {lists.map(list => {
          const running = batch?.listId === list.id
          return (
            <Stack key={list.id} spacing={0.5} sx={{ py: 1 }}>
              <Stack direction="row" sx={{ alignItems: 'center' }}>
                <Stack sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontWeight: list.id === activeListId ? 600 : 400 }}>
                    {list.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {list.items.length} labels{list.id === activeListId ? ' · in use' : ''}
                  </Typography>
                </Stack>
                <Tooltip title="Edit labels">
                  <IconButton
                    size="small" aria-label={`Edit ${list.name}`}
                    onClick={() => setEditing({ id: list.id, name: list.name, text: list.items.join('\n') })}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete list">
                  <IconButton size="small" aria-label={`Delete ${list.name}`} onClick={() => void remove(list)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              <Stack direction="row" spacing={1}>
                <Button size="small" disabled={list.id === activeListId} onClick={() => onUse(list)}>
                  Use for this bin
                </Button>
                <Tooltip title="One STL per label, this bin's size and options, zipped">
                  <span>
                    <Button size="small" disabled={!!batch} onClick={() => void exportAll(list)}>
                      Export a bin per label
                    </Button>
                  </span>
                </Tooltip>
              </Stack>
              {running && batch && (
                <Stack spacing={0.5}>
                  <LinearProgress variant="determinate" value={(batch.done / Math.max(1, batch.total)) * 100} />
                  <Typography variant="body2" color="text.secondary">
                    Building bin {Math.min(batch.done + 1, batch.total)} of {batch.total}…
                  </Typography>
                </Stack>
              )}
            </Stack>
          )
        })}
      </Stack>

      <Dialog open={!!editing} onClose={() => !saving && setEditing(null)} fullWidth maxWidth="sm">
        <DialogTitle>{editing?.id ? 'Edit label list' : 'New label list'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <TextField
              label="List name" size="small" autoFocus value={editing?.name ?? ''}
              slotProps={{ htmlInput: { maxLength: LABEL_LIST_LIMITS.nameMaxLength } }}
              onChange={e => setEditing(ed => ed && { ...ed, name: e.target.value })}
            />
            <TextField
              label="Labels, one per line" multiline minRows={10} maxRows={20} value={editing?.text ?? ''}
              onChange={e => setEditing(ed => ed && { ...ed, text: e.target.value })}
              helperText={`${draftCount} labels. Blank lines and duplicates are dropped; each label is cut to ${LABEL_LIST_LIMITS.itemMaxLength} characters.`}
            />
            {!!draft?.dropped && (
              <Alert severity="warning">
                Only the first {LABEL_LIST_LIMITS.maxItems} labels will be kept; {draft.dropped} past that are left out.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={saving} onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="contained" disabled={saving} onClick={() => void saveEdit()}>
            {editing?.id ? 'Save list' : 'Create list'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
