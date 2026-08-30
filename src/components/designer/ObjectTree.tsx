// The object list. No such panel existed before -- the keycap tray's left panel
// is an add-palette, not a list of what is placed -- so this is new, and all
// three sub-apps share it.
import { Fragment } from 'react'
import {
  Box, IconButton, Stack, Tooltip, Typography,
} from '@mui/material'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import LockOpenRoundedIcon from '@mui/icons-material/LockOpenRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import CircleRoundedIcon from '@mui/icons-material/CircleRounded'
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded'
import type { GroupObject, SceneObject } from '../../model/document.ts'
import { EmptyState } from '../LoadingState.tsx'

export interface ObjectTreeProps {
  objects: readonly SceneObject[]
  selection: Set<string>
  onSelect: (id: string, additive: boolean) => void
  onToggleVisible: (id: string, visible: boolean) => void
  onToggleLocked: (id: string, locked: boolean) => void
}

const isGroup = (o: SceneObject): o is GroupObject => o.type === 'group'

const describe = (o: SceneObject): string => {
  switch (o.type) {
    case 'group': return `Group of ${o.children.length}`
    case 'solid': return o.primitive
    case 'shape2d': return o.shape
    case 'text': return 'text'
    case 'path': return o.source ? `${o.source.format} outline` : 'outline'
    case 'imported': return o.format
  }
}

export default function ObjectTree(props: ObjectTreeProps) {
  const { objects, selection, onSelect, onToggleVisible, onToggleLocked } = props

  if (!objects.length) {
    return <EmptyState title="Nothing yet" description="Add a shape to get started." />
  }

  const row = (o: SceneObject, depth: number) => {
    const selected = selection.has(o.id)
    return (
      <Fragment key={o.id}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={0.5}
          role="button"
          tabIndex={0}
          aria-pressed={selected}
          onClick={e => onSelect(o.id, e.shiftKey || e.metaKey || e.ctrlKey)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelect(o.id, e.shiftKey || e.metaKey || e.ctrlKey)
            }
          }}
          sx={{
            pl: 0.75 + depth * 1.5,
            pr: 0.5,
            py: 0.5,
            borderRadius: 1,
            cursor: 'pointer',
            bgcolor: selected ? 'action.selected' : 'transparent',
            '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
            opacity: o.visible ? 1 : 0.5,
          }}
        >
          <Box sx={{ display: 'flex', color: 'text.secondary' }}>
            {isGroup(o)
              ? <FolderRoundedIcon sx={{ fontSize: 15 }} />
              : o.mode === 'hole'
                ? <RadioButtonUncheckedRoundedIcon sx={{ fontSize: 15 }} />
                : <CircleRoundedIcon sx={{ fontSize: 15 }} />}
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" noWrap>{o.name}</Typography>
            <Typography variant="body2" noWrap sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>
              {describe(o)}{o.mode === 'hole' ? ' · hole' : ''}
            </Typography>
          </Box>
          <Tooltip title={o.visible ? 'Hide' : 'Show'} describeChild>
            <IconButton
              size="small"
              aria-label={o.visible ? `Hide ${o.name}` : `Show ${o.name}`}
              aria-pressed={!o.visible}
              onClick={e => { e.stopPropagation(); onToggleVisible(o.id, !o.visible) }}
            >
              {o.visible
                ? <VisibilityRoundedIcon sx={{ fontSize: 16 }} />
                : <VisibilityOffRoundedIcon sx={{ fontSize: 16 }} />}
            </IconButton>
          </Tooltip>
          <Tooltip title={o.locked ? 'Unlock' : 'Lock'} describeChild>
            <IconButton
              size="small"
              aria-label={o.locked ? `Unlock ${o.name}` : `Lock ${o.name}`}
              aria-pressed={o.locked}
              onClick={e => { e.stopPropagation(); onToggleLocked(o.id, !o.locked) }}
            >
              {o.locked
                ? <LockRoundedIcon sx={{ fontSize: 16 }} />
                : <LockOpenRoundedIcon sx={{ fontSize: 16 }} />}
            </IconButton>
          </Tooltip>
        </Stack>
        {isGroup(o) && o.children.map(child => row(child, depth + 1))}
      </Fragment>
    )
  }

  return (
    <Stack spacing={0.25} role="list" aria-label="Objects">
      {objects.map(o => row(o, 0))}
    </Stack>
  )
}
