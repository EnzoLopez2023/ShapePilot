import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import PushPinIcon from '@mui/icons-material/PushPin'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import { pocketWidth } from '../geometry/shapes.ts'
import type { PocketSizing } from '../geometry/shapes.ts'
import * as api from '../service.ts'
import {
  ALL_LIBRARY_ITEMS, COMMON_ITEMS, libraryPocketToItem, loadCommonKeys, saveCommonKeys,
  SMALL_SQUARE_SEED, type PaletteItem,
} from '../model/defaults.ts'

export interface PocketPaletteProps {
  sizing: PocketSizing
  onAdd: (item: PaletteItem) => void
}

type Tab = 'common' | 'all' | 'custom'

const num = (v: string): number | undefined => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}

export default function PocketPalette({ sizing, onAdd }: PocketPaletteProps) {
  const [filter, setFilter] = useState('')
  const [tab, setTab] = useState<Tab>('common')
  const [commonKeys, setCommonKeys] = useState<Set<string>>(() => loadCommonKeys())
  const [custom, setCustom] = useState<PaletteItem[]>([])
  const [loadingCustom, setLoadingCustom] = useState(false)
  const [customError, setCustomError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [draft, setDraft] = useState({ name: '', units: '1', widthMm: '', heightMm: '', cornerRadiusMm: '' })

  const refreshCustom = useCallback(async () => {
    setLoadingCustom(true)
    try {
      const rows = await api.listLibraryPockets()
      setCustom(rows.map(libraryPocketToItem))
      setCustomError(null)
    } catch (e) {
      setCustomError((e as Error).message)
    } finally {
      setLoadingCustom(false)
    }
  }, [])

  useEffect(() => { void refreshCustom() }, [refreshCustom])

  // Seed the "smaller than 1u" example the first time the library is empty,
  // so there's something to drag below the unit formula's floor without
  // making the user build one from scratch. Idempotent -- checked by name.
  useEffect(() => {
    if (loadingCustom) return
    if (custom.some(c => c.label === SMALL_SQUARE_SEED.name)) return
    if (custom.length > 0) return
    void api.saveLibraryPocket(SMALL_SQUARE_SEED).then(refreshCustom).catch(() => { /* best-effort */ })
    // Only ever runs once per empty-library observation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingCustom])

  const togglePin = useCallback((key: string) => {
    setCommonKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      saveCommonKeys(next)
      return next
    })
  }, [])

  const removeCustom = useCallback(async (item: PaletteItem) => {
    if (!item.libraryId) return
    try {
      await api.deleteLibraryPocket(item.libraryId)
      await refreshCustom()
    } catch (e) { setCustomError((e as Error).message) }
  }, [refreshCustom])

  const addCustom = useCallback(async () => {
    if (!draft.name.trim()) return
    try {
      await api.saveLibraryPocket({
        name: draft.name.trim(),
        units: num(draft.units) ?? 1,
        widthMm: num(draft.widthMm),
        heightMm: num(draft.heightMm),
        cornerRadiusMm: num(draft.cornerRadiusMm),
      })
      setDraft({ name: '', units: '1', widthMm: '', heightMm: '', cornerRadiusMm: '' })
      setAddOpen(false)
      await refreshCustom()
    } catch (e) { setCustomError((e as Error).message) }
  }, [draft, refreshCustom])

  const allByKey = useMemo(() => {
    const m = new Map<string, PaletteItem>()
    for (const i of [...COMMON_ITEMS, ...ALL_LIBRARY_ITEMS, ...custom]) m.set(i.key, i)
    return m
  }, [custom])

  const items = useMemo(() => {
    const base = tab === 'common'
      ? [...commonKeys].map(k => allByKey.get(k)).filter((i): i is PaletteItem => !!i)
      : tab === 'all' ? ALL_LIBRARY_ITEMS
      : custom
    if (!filter.trim()) return base
    const q = filter.trim().toLowerCase()
    return base.filter(i => i.label.toLowerCase().includes(q) || (i.typical ?? '').toLowerCase().includes(q))
  }, [tab, commonKeys, allByKey, custom, filter])

  const widthOf = (item: PaletteItem): number => {
    if (item.shape === 'iso-enter') return pocketWidth(1.5, sizing)
    return item.widthMm ?? pocketWidth(item.units, sizing)
  }

  return (
    <Stack spacing={1.25} sx={{ height: '100%', minHeight: 0, p: 1.5 }}>
      <Typography variant="h3" component="h2">Pockets</Typography>

      <TextField
        size="small"
        placeholder="Filter by size or key"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        slotProps={{ htmlInput: { 'aria-label': 'Filter pockets' } }}
      />

      <Stack direction="row" spacing={0.75} role="tablist" aria-label="Pocket source">
        <Chip
          size="small" label="Common" onClick={() => setTab('common')}
          role="tab" aria-selected={tab === 'common'}
          variant={tab === 'common' ? 'filled' : 'outlined'}
        />
        <Chip
          size="small" label="All 1u–13u" onClick={() => setTab('all')}
          role="tab" aria-selected={tab === 'all'}
          variant={tab === 'all' ? 'filled' : 'outlined'}
        />
        <Chip
          size="small" label="Custom" onClick={() => setTab('custom')}
          role="tab" aria-selected={tab === 'custom'}
          variant={tab === 'custom' ? 'filled' : 'outlined'}
        />
      </Stack>

      {tab === 'common' && (
        <Typography variant="body2" color="text.secondary">
          Pin any size in All or Custom to add it here; unpin to remove it.
        </Typography>
      )}
      {tab === 'custom' && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Tooltip title="Define a pocket by exact width/height instead of a unit multiple — for artisan caps, novelty sizes, or anything below 1u.">
            <span>
              <Chip
                size="small" icon={<AddIcon fontSize="small" />} label="Add custom pocket"
                onClick={() => setAddOpen(true)}
              />
            </span>
          </Tooltip>
          {loadingCustom && <CircularProgress size={14} aria-label="Loading custom pockets" />}
        </Stack>
      )}
      {customError && (
        <Typography variant="body2" color="error" role="alert">{customError}</Typography>
      )}

      <Box sx={{ overflowY: 'auto', minHeight: 0, flex: 1, pr: 0.5 }}>
        {items.map(item => {
          const pinned = commonKeys.has(item.key)
          return (
            <Box
              key={item.key}
              draggable
              onDragStart={e => {
                e.dataTransfer.setData('application/json', JSON.stringify(item))
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => onAdd(item)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAdd(item) }
              }}
              role="button"
              tabIndex={0}
              aria-label={`Add a ${item.label} pocket`}
              sx={{
                p: 1,
                mb: 0.5,
                position: 'relative',
                borderRadius: 1,
                border: '1px solid transparent',
                cursor: 'pointer',
                '&:hover': { borderColor: 'divider', bgcolor: 'action.hover' },
              }}
            >
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', pr: 5 }}>
                <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{item.label}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {widthOf(item).toFixed(2)} mm
                </Typography>
              </Stack>
              {item.typical && (
                <Typography variant="body2" color="text.secondary" sx={{ pr: 5 }}>{item.typical}</Typography>
              )}
              <Stack direction="row" spacing={0.25} sx={{ position: 'absolute', top: 2, right: 2 }}>
                {tab === 'custom' && item.libraryId && (
                  <Tooltip title="Delete this custom pocket">
                    <IconButton
                      size="small"
                      aria-label={`Delete ${item.label}`}
                      onClick={e => { e.stopPropagation(); void removeCustom(item) }}
                    >
                      <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title={pinned ? 'Remove from Common' : 'Add to Common'}>
                  <IconButton
                    size="small"
                    aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
                    aria-pressed={pinned}
                    onClick={e => { e.stopPropagation(); togglePin(item.key) }}
                  >
                    {pinned
                      ? <PushPinIcon sx={{ fontSize: 16 }} />
                      : <PushPinOutlinedIcon sx={{ fontSize: 16, opacity: 0.6 }} />}
                  </IconButton>
                </Tooltip>
              </Stack>
            </Box>
          )
        })}
        {!items.length && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
            {tab === 'custom' ? 'No custom pockets yet.' : 'No matching sizes.'}
          </Typography>
        )}
      </Box>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add a custom pocket</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <TextField
              size="small" label="Name" autoFocus
              value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            />
            <Tooltip title="Nominal key width, in u. Only used for sorting and the drag preview when width/height below are left blank.">
              <TextField
                size="small" label="Units (u)" type="number"
                value={draft.units} onChange={e => setDraft(d => ({ ...d, units: e.target.value }))}
              />
            </Tooltip>
            <Stack direction="row" spacing={1}>
              <Tooltip title="Leave blank to derive from units using the tray's sizing formula.">
                <TextField
                  size="small" label="Width (mm)" type="number"
                  value={draft.widthMm} onChange={e => setDraft(d => ({ ...d, widthMm: e.target.value }))}
                />
              </Tooltip>
              <Tooltip title="Leave blank to derive from units using the tray's sizing formula.">
                <TextField
                  size="small" label="Height (mm)" type="number"
                  value={draft.heightMm} onChange={e => setDraft(d => ({ ...d, heightMm: e.target.value }))}
                />
              </Tooltip>
            </Stack>
            <Tooltip title="Leave blank to use the tray's default corner radius.">
              <TextField
                size="small" label="Corner radius (mm)" type="number"
                value={draft.cornerRadiusMm} onChange={e => setDraft(d => ({ ...d, cornerRadiusMm: e.target.value }))}
              />
            </Tooltip>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!draft.name.trim()} onClick={() => void addCustom()}>Add</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
