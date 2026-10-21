// The menu bar every designer shares, in the Office idiom: File, Edit, View,
// Tools in a fixed order on a single row that never wraps, so New / Open /
// Save As sit in the same place on every page at every window size.
//
// A page describes what its menus do with `useAppMenu`; the shell draws them.
// An item a page does not supply is shown disabled rather than removed, so the
// menus keep their shape from one page to the next.
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react'
import type { ReactNode } from 'react'
import { Box, Button, Divider, ListItemText, Menu, MenuItem, Typography } from '@mui/material'

export interface MenuAction {
  label: string
  /** Display only, e.g. "Ctrl+S". Global handling is limited to Save and Open. */
  shortcut?: string
  onClick?: () => void
  /** Absent onClick also reads as disabled. */
  disabled?: boolean
  /** Draw a rule above this item. */
  dividerBefore?: boolean
}

export type MenuId = 'file' | 'edit' | 'view' | 'tools'

export type AppMenuModel = Partial<Record<MenuId, MenuAction[]>>

const MENU_ORDER: { id: MenuId; label: string }[] = [
  { id: 'file', label: 'File' },
  { id: 'edit', label: 'Edit' },
  { id: 'view', label: 'View' },
  { id: 'tools', label: 'Tools' },
]

/** The standard File and Edit entries, in their one fixed order. */
export interface StandardActions {
  onNew?: () => void
  onOpen?: () => void
  onSave?: () => void
  onSaveAs?: () => void
  saveDisabled?: boolean
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  onDuplicate?: () => void
  onDelete?: () => void
  canDuplicate?: boolean
  canDelete?: boolean
  /** Export entries, drawn under a rule after Save As. */
  exports?: MenuAction[]
  /** Page-specific additions, appended after the standard entries. */
  file?: MenuAction[]
  edit?: MenuAction[]
  view?: MenuAction[]
  tools?: MenuAction[]
}

export function standardMenu(a: StandardActions): AppMenuModel {
  const file: MenuAction[] = [
    { label: 'New', onClick: a.onNew },
    { label: 'Open…', shortcut: 'Ctrl+O', onClick: a.onOpen },
    { label: 'Save', shortcut: 'Ctrl+S', onClick: a.onSave, disabled: a.saveDisabled, dividerBefore: true },
    { label: 'Save As…', onClick: a.onSaveAs },
    ...(a.exports ?? []).map((e, i) => (i === 0 ? { ...e, dividerBefore: true } : e)),
    ...(a.file ?? []).map((e, i) => (i === 0 ? { ...e, dividerBefore: true } : e)),
  ]
  const edit: MenuAction[] = [
    { label: 'Undo', shortcut: 'Ctrl+Z', onClick: a.onUndo, disabled: a.canUndo === false },
    { label: 'Redo', shortcut: 'Ctrl+Shift+Z', onClick: a.onRedo, disabled: a.canRedo === false },
    { label: 'Duplicate', shortcut: 'Ctrl+D', onClick: a.onDuplicate, disabled: a.canDuplicate === false, dividerBefore: true },
    { label: 'Delete', shortcut: 'Del', onClick: a.onDelete, disabled: a.canDelete === false },
    ...(a.edit ?? []).map((e, i) => (i === 0 ? { ...e, dividerBefore: true } : e)),
  ]
  return { file, edit, view: a.view, tools: a.tools }
}

type SetModel = (model: AppMenuModel | null) => void

const SetModelContext = createContext<SetModel>(() => {})
const ModelContext = createContext<AppMenuModel | null>(null)

export function AppMenuProvider({ children }: { children: ReactNode }) {
  const [model, setModel] = useState<AppMenuModel | null>(null)
  return (
    <SetModelContext.Provider value={setModel}>
      <ModelContext.Provider value={model}>{children}</ModelContext.Provider>
    </SetModelContext.Provider>
  )
}

/**
 * Registers a page's menus for as long as it is mounted. The model is
 * re-registered on every render so labels and enabled states stay current;
 * the setter context is stable, so the page itself is never re-rendered by it.
 */
export function useAppMenu(model: AppMenuModel): void {
  const setModel = useContext(SetModelContext)
  useEffect(() => { setModel(model) })
  useEffect(() => () => setModel(null), [setModel])

  // Ctrl+S and Ctrl+O belong to the app, not the browser's own dialogs.
  const save = model.file?.find(i => i.label === 'Save')
  const open = model.file?.find(i => i.label === 'Open…')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
      const key = e.key.toLowerCase()
      const item = key === 's' ? save : key === 'o' ? open : undefined
      if (!item) return
      e.preventDefault()
      if (!item.disabled) item.onClick?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, open])
}

/** Drawn by the shell; renders nothing on a page that registered no menus. */
export function AppMenuBar() {
  const model = useContext(ModelContext)
  const [open, setOpen] = useState<{ id: MenuId; anchor: HTMLElement } | null>(null)
  const close = useCallback(() => setOpen(null), [])
  const items = useMemo(() => (open && model ? model[open.id] ?? [] : []), [open, model])

  if (!model) return null
  return (
    <Box
      role="menubar"
      aria-label="Application menu"
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0,
        height: 36, px: 0.5, overflow: 'hidden', whiteSpace: 'nowrap',
        borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper',
      }}
    >
      {MENU_ORDER.map(({ id, label }) => {
        const entries = model[id]
        const active = open?.id === id
        return (
          <Button
            key={id}
            size="small"
            color="inherit"
            disabled={!entries?.length}
            aria-haspopup="menu"
            aria-expanded={active}
            onClick={e => setOpen({ id, anchor: e.currentTarget })}
            // Moving along the bar with a menu open follows the pointer, as in Office.
            onMouseEnter={e => { if (open && !active && entries?.length) setOpen({ id, anchor: e.currentTarget }) }}
            sx={{ minWidth: 0, px: 1.25, fontWeight: 500, bgcolor: active ? 'action.selected' : undefined }}
          >
            {label}
          </Button>
        )
      })}
      <Menu
        open={!!open}
        anchorEl={open?.anchor}
        onClose={close}
        slotProps={{ list: { dense: true, 'aria-label': open?.id } }}
      >
        {items.flatMap((item, i) => [
          ...(item.dividerBefore && i > 0 ? [<Divider key={`d${i}`} component="li" />] : []),
          <MenuItem
            key={`${item.label}${i}`}
            disabled={item.disabled || !item.onClick}
            onClick={() => { close(); item.onClick?.() }}
            sx={{ minWidth: 220 }}
          >
            <ListItemText>{item.label}</ListItemText>
            {item.shortcut && (
              <Typography variant="body2" color="text.secondary" sx={{ ml: 3 }}>
                {item.shortcut}
              </Typography>
            )}
          </MenuItem>,
        ])}
      </Menu>
    </Box>
  )
}
