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
//
// Each card carries an overflow menu: duplicate within the set, duplicate into
// another set, or delete. Deleting a tray removes the design; per PRODUCT.md
// that is the one place a tray is destroyed rather than unassigned, so it goes
// through the app's one confirm dialog.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  Menu, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import { useNavigate } from 'react-router-dom'
import * as trays from '../../keycap-tray/service.ts'
import * as projectsApi from '../service.ts'
import type { TrayDesign } from '../../keycap-tray/model/types.ts'
import type { ProjectSummary } from '../model/types.ts'
import { errorMessage } from '../../../services/errors.ts'
import { useConfirm } from '../../../components/ConfirmDialogProvider.tsx'
import { LoadingState } from '../../../components/LoadingState.tsx'
import TrayThumbnail from './TrayThumbnail.tsx'

export interface TrayPreviewsProps {
  trays: { id: string; name: string; pocketCount: number }[]
  /** The set this list belongs to -- offered as "this set" when duplicating. */
  currentProjectId: string
  currentProjectName: string
  /** Re-pull the project after a tray is added or removed here. */
  onChanged: () => void
  onToast: (message: string) => void
  onError: (message: string) => void
}

export default function TrayPreviews({
  trays: summaries, currentProjectId, currentProjectName, onChanged, onToast, onError,
}: TrayPreviewsProps) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [designs, setDesigns] = useState<Record<string, TrayDesign>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  // The row whose overflow menu is open, and the anchor it hangs from.
  const [menu, setMenu] = useState<{ id: string; name: string; anchor: HTMLElement } | null>(null)
  // The tray being duplicated into another set, once that item is chosen.
  const [moveTarget, setMoveTarget] = useState<{ id: string; name: string } | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [destination, setDestination] = useState('')

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

  const open = useCallback((id: string) => navigate(`/keycap-tray/${id}`), [navigate])

  const duplicate = useCallback(async (id: string, projectId?: string) => {
    setMenu(null)
    setBusy(true)
    try {
      const { id: copyId } = await trays.cloneDesign(id, undefined, projectId)
      if (projectId && projectId !== currentProjectId) {
        const where = projects.find(p => p.id === projectId)?.name ?? 'the other set'
        onToast(`Copied to ${where}`)
        onChanged()
      } else {
        onToast('Tray duplicated')
        onChanged()
        open(copyId)
      }
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }, [currentProjectId, projects, onToast, onError, onChanged, open])

  const remove = useCallback(async (id: string, name: string) => {
    setMenu(null)
    const ok = await confirm({
      title: 'Delete this tray?',
      message: `"${name}" and its pockets will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await trays.deleteDesign(id)
      onToast('Tray deleted')
      onChanged()
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }, [confirm, onToast, onError, onChanged])

  // The move dialog opens with the project list still loading in the
  // background; a failure just leaves it with the current set to copy into.
  const startMove = useCallback((id: string, name: string) => {
    setMenu(null)
    setMoveTarget({ id, name })
    setDestination('')
    void projectsApi.listProjects()
      .then(list => {
        setProjects(list)
        const firstOther = list.find(p => p.id !== currentProjectId)
        setDestination(firstOther?.id ?? currentProjectId)
      })
      .catch(() => { /* dialog falls back to the current set */ })
  }, [currentProjectId])

  const options = useMemo(() => {
    const others = projects.filter(p => p.id !== currentProjectId)
    return [{ id: currentProjectId, name: `${currentProjectName} (this set)` }, ...others]
  }, [projects, currentProjectId, currentProjectName])

  if (!summaries.length) return null
  if (loading && !Object.keys(designs).length) {
    return <LoadingState label="Drawing the trays…" fill={false} />
  }

  return (
    <>
      <Stack spacing={1}>
        {summaries.map(summary => {
          const design = designs[summary.id]
          if (!design) return null
          return (
            <Box key={summary.id} sx={{ position: 'relative' }}>
              <Box
                role="button"
                tabIndex={0}
                aria-label={`Open ${summary.name}`}
                onClick={() => open(summary.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    open(summary.id)
                  }
                }}
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 2,
                  p: 1,
                  cursor: 'pointer',
                  color: 'text.primary',
                  transition: 'border-color 160ms ease-in-out, background-color 160ms ease-in-out',
                  '&:hover': { bgcolor: 'action.hover', borderColor: 'text.disabled' },
                }}
              >
                <Box sx={{ height: 96, mb: 0.5 }}>
                  <TrayThumbnail
                    design={design}
                    label={`${summary.name}, ${summary.pocketCount} pockets`}
                  />
                </Box>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 600, pr: 4 }}
                  noWrap
                >
                  {summary.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {summary.pocketCount} {summary.pocketCount === 1 ? 'pocket' : 'pockets'}
                </Typography>
              </Box>
              <IconButton
                size="small"
                aria-label={`More actions for ${summary.name}`}
                disabled={busy}
                onClick={e => setMenu({ id: summary.id, name: summary.name, anchor: e.currentTarget })}
                sx={{ position: 'absolute', top: 6, right: 6 }}
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
            </Box>
          )
        })}
      </Stack>

      <Menu
        open={menu !== null}
        anchorEl={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          disabled={busy}
          onClick={() => { if (menu) void duplicate(menu.id) }}
        >
          <ContentCopyIcon fontSize="small" sx={{ mr: 1.25 }} />
          Duplicate
        </MenuItem>
        <MenuItem
          disabled={busy}
          onClick={() => { if (menu) startMove(menu.id, menu.name) }}
        >
          <DriveFileMoveOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
          Duplicate into set…
        </MenuItem>
        <MenuItem
          disabled={busy}
          onClick={() => { if (menu) void remove(menu.id, menu.name) }}
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1.25 }} />
          Delete tray
        </MenuItem>
      </Menu>

      <Dialog
        open={moveTarget !== null}
        onClose={() => setMoveTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Duplicate into another set</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            A copy of “{moveTarget?.name}” is added to the set you choose. The
            original stays here.
          </Typography>
          <TextField
            select
            fullWidth
            size="small"
            label="Destination set"
            value={destination}
            onChange={e => setDestination(e.target.value)}
          >
            {options.map(option => (
              <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={busy || !destination}
            onClick={() => {
              if (!moveTarget) return
              const target = moveTarget
              setMoveTarget(null)
              void duplicate(target.id, destination)
            }}
          >
            Duplicate
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
