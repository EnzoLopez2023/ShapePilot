import { Box, Card, CardActionArea, Chip, Stack, Typography } from '@mui/material'
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded'
import { Link } from 'react-router-dom'
import { LIBRARY_STATUS_LABELS } from '../../../../lib/contracts/library.ts'
import type { LibraryModel } from '../../../../lib/contracts/library.ts'
import {
  STATUS_COLOR, categoryLabel, formatDimensions, formatDuration, formatGrams, formatLabel, isNewModel,
} from '../model/format.ts'
import { LibraryThumb } from './LibraryThumb.tsx'

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

export function ModelCard({ model }: { model: LibraryModel }) {
  const estimate = model.estSeconds || model.estGrams != null
  const meta = [categoryLabel(model.category), model.designer].filter(Boolean).join(' · ')
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardActionArea component={Link} to={`/library/${model.id}`} sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
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
            <Typography sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{model.title}</Typography>
            {model.favorite && <FavoriteRoundedIcon color="error" fontSize="small" titleAccess="Favorite" />}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Chip label={LIBRARY_STATUS_LABELS[model.status]} color={STATUS_COLOR[model.status]} size="small" variant="outlined" />
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
      </CardActionArea>
    </Card>
  )
}
