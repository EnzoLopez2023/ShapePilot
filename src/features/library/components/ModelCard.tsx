import { useState } from 'react'
import { Box, Card, Chip, IconButton, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material'
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import FavoriteBorderRoundedIcon from '@mui/icons-material/FavoriteBorderRounded'
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded'
import { Link } from 'react-router-dom'
import { LIBRARY_STATUS_LABELS } from '../../../../lib/contracts/library.ts'
import type { LibraryModel, LibraryStatus } from '../../../../lib/contracts/library.ts'
import {
  STATUS_COLOR, STATUS_ORDER, categoryLabel, formatDimensions, formatDuration, formatGrams, formatLabel, isNewModel,
} from '../model/format.ts'
import { LibraryThumb } from './LibraryThumb.tsx'

/** What a card can change in place; the page saves it. */
export type ModelCardChange = { status: LibraryStatus } | { favorite: boolean }

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }} noWrap>{value}</Typography>
    </Box>
  )
}

// The whole card opens the model, but a link cannot hold buttons. So the title
// link stretches over the card (its ::after), and the status menu and the heart
// sit above that overlay as controls of their own.
const ABOVE_LINK = { position: 'relative', zIndex: 1 } as const

export function ModelCard({ model, onChange }: { model: LibraryModel; onChange?: (change: ModelCardChange) => void }) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const estimate = model.estSeconds || model.estGrams != null
  const meta = [categoryLabel(model.category), model.designer].filter(Boolean).join(' · ')
  const statusLabel = LIBRARY_STATUS_LABELS[model.status]
  const pickStatus = (status: LibraryStatus) => {
    setMenuAnchor(null)
    if (status !== model.status) onChange?.({ status })
  }

  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%', position: 'relative', display: 'flex', flexDirection: 'column',
        transition: 'border-color 120ms ease',
        '&:hover': { borderColor: 'text.secondary' },
        '&:focus-within:has(a:focus-visible)': { outline: 2, outlineColor: 'primary.main', outlineStyle: 'solid', outlineOffset: 2 },
      }}
    >
      <Box sx={{ position: 'relative', aspectRatio: '4 / 3' }}>
        <LibraryThumb hash={model.thumbHash} iconSize={44} />
        {isNewModel(model) && (
          <Chip label="New" size="small" color="primary" sx={{ position: 'absolute', top: 8, left: 8 }} />
        )}
        <Stack direction="row" spacing={0.5} sx={{ position: 'absolute', bottom: 8, right: 8 }}>
          {model.formats.map(format => (
            <Chip key={format} label={formatLabel(format)} size="small" sx={{ bgcolor: 'background.paper', height: 20, fontSize: 11 }} />
          ))}
        </Stack>
      </Box>
      <Stack spacing={1} sx={{ p: 1.5, flex: 1 }}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'flex-start' }}>
          <Typography
            component={Link}
            to={`/library/${model.id}`}
            sx={{
              fontWeight: 600, flex: 1, minWidth: 0, color: 'text.primary', textDecoration: 'none', outline: 'none',
              '&::after': { content: '""', position: 'absolute', inset: 0 },
            }}
          >
            {model.title}
          </Typography>
          {onChange ? (
            <Tooltip title={model.favorite ? 'Remove favorite' : 'Mark favorite'}>
              <IconButton
                size="small"
                aria-pressed={model.favorite}
                aria-label={model.favorite ? `Remove ${model.title} from favorites` : `Mark ${model.title} favorite`}
                onClick={() => onChange({ favorite: !model.favorite })}
                sx={{ ...ABOVE_LINK, m: -0.5, color: model.favorite ? 'error.main' : 'text.disabled', '&:hover': { color: 'error.main' } }}
              >
                {model.favorite ? <FavoriteRoundedIcon fontSize="small" /> : <FavoriteBorderRoundedIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          ) : model.favorite && <FavoriteRoundedIcon color="error" fontSize="small" titleAccess="Favorite" />}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
          {onChange ? (
            <>
              <Chip
                label={(
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
                    {statusLabel}
                    <ArrowDropDownRoundedIcon aria-hidden sx={{ fontSize: 18, mr: -0.75 }} />
                  </Box>
                )}
                color={STATUS_COLOR[model.status]}
                size="small"
                variant="outlined"
                onClick={event => setMenuAnchor(event.currentTarget)}
                aria-haspopup="menu"
                aria-expanded={menuAnchor ? true : undefined}
                aria-label={`Status: ${statusLabel}. Change status`}
                sx={{ ...ABOVE_LINK, flexShrink: 0 }}
              />
              <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
                {STATUS_ORDER.map(status => (
                  <MenuItem key={status} selected={status === model.status} onClick={() => pickStatus(status)} sx={{ gap: 1 }}>
                    <CheckRoundedIcon fontSize="small" sx={{ visibility: status === model.status ? 'visible' : 'hidden' }} />
                    {LIBRARY_STATUS_LABELS[status]}
                  </MenuItem>
                ))}
              </Menu>
            </>
          ) : (
            <Chip label={statusLabel} color={STATUS_COLOR[model.status]} size="small" variant="outlined" />
          )}
          <Typography variant="body2" color="text.secondary" noWrap>{meta}</Typography>
        </Stack>
        {model.tags.length > 0 && (
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            {model.tags.slice(0, 3).map(tag => <Chip key={tag} label={tag} size="small" />)}
            {model.tags.length > 3 && <Chip label={`+${model.tags.length - 3}`} size="small" />}
          </Stack>
        )}
        <Box sx={{ flex: 1 }} />
        <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 1 }}>
          <Stat
            label={estimate ? 'Print' : 'Size'}
            value={estimate ? `${formatDuration(model.estSeconds)} · ${formatGrams(model.estGrams)}` : formatDimensions(model.bbox)}
          />
          <Stat label="Plates" value={model.plateCount ? String(model.plateCount) : '—'} />
          <Stat label="Printed" value={model.printedCount ? `×${model.printedCount}` : '—'} />
        </Box>
      </Stack>
    </Card>
  )
}
