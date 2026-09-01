// A photo as a starting point: pick a picture of a logo or drawing, and the
// assistant traces it into vector paths.
//
// The bytes go up through the ordinary asset route (PUT /api/design-assets/:hash)
// first; only the resulting content hash is handed to the trace. Playground
// photos are scratch input -- they are not written to the document -- so this
// component owns their whole lifetime and revokes every object URL it makes.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box, Button, CircularProgress, IconButton, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import AddPhotoIcon from '@mui/icons-material/AddPhotoAlternateOutlined'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeRounded'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import { uploadAsset } from '../../services/designAssets.ts'
import { hashBytes } from '../../import/assetStore.ts'
import { PHOTO_ACCEPT, preparePhoto } from '../../import/preparePhoto.ts'
import { errorMessage } from '../../services/errors.ts'

/** A photo is a trace seed, not a gallery -- one clear shot is the usual case. */
const MAX_PHOTOS = 4

interface Photo { hash: string; name: string; url: string }

export interface PhotoSourcePanelProps {
  available: boolean
  busy: boolean
  onTrace: (hashes: string[], hint: string) => void
  onError: (message: string) => void
}

export default function PhotoSourcePanel(props: PhotoSourcePanelProps) {
  const { available, busy, onTrace, onError } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [hint, setHint] = useState('')
  const [uploading, setUploading] = useState(false)

  // Revoke on unmount only. A ref, not the state in a dep array: depending on
  // `photos` would revoke a still-shown URL on every add.
  const live = useRef<Photo[]>([])
  live.current = photos
  useEffect(() => () => { live.current.forEach(p => URL.revokeObjectURL(p.url)) }, [])

  const pick = useCallback(async (file: File) => {
    setUploading(true)
    try {
      const prepared = await preparePhoto(file)
      const hash = await hashBytes(prepared.bytes)
      await uploadAsset(hash, prepared.bytes, prepared.filename, prepared.format)
      const url = URL.createObjectURL(new Blob([prepared.bytes], { type: 'image/jpeg' }))
      setPhotos(prev =>
        prev.some(p => p.hash === hash)
          ? (URL.revokeObjectURL(url), prev)
          : [...prev, { hash, name: file.name, url }])
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setUploading(false)
    }
  }, [onError])

  const remove = useCallback((hash: string) => {
    setPhotos(prev => {
      const gone = prev.find(p => p.hash === hash)
      if (gone) URL.revokeObjectURL(gone.url)
      return prev.filter(p => p.hash !== hash)
    })
  }, [])

  const full = photos.length >= MAX_PHOTOS
  const disabled = busy || uploading

  return (
    <Stack spacing={1}>
      <Typography variant="h3">From a photo</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Add a picture of a logo or drawing and the assistant traces it into
        editable vector paths.
      </Typography>

      <input
        type="file"
        hidden
        ref={inputRef}
        accept={PHOTO_ACCEPT}
        onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void pick(file)
        }}
      />

      {photos.length > 0 && (
        <Box
          component="ul"
          sx={{
            listStyle: 'none', m: 0, p: 0, display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 0.75,
          }}
        >
          {photos.map(photo => (
            <Box
              key={photo.hash}
              component="li"
              sx={{
                position: 'relative', borderRadius: 2, overflow: 'hidden',
                border: 1, borderColor: 'divider', aspectRatio: '4 / 3',
                bgcolor: 'background.default',
              }}
            >
              <Box
                component="img"
                src={photo.url}
                alt={photo.name}
                sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              <IconButton
                size="small"
                aria-label={`Remove ${photo.name}`}
                disabled={disabled}
                onClick={() => remove(photo.hash)}
                sx={{
                  position: 'absolute', top: 2, right: 2, bgcolor: 'background.paper',
                  '&:hover': { bgcolor: 'background.paper' },
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Tooltip title={full ? `Up to ${MAX_PHOTOS} photos.` : 'Pictures are scaled down before they are stored.'}>
          <span>
            <Button
              size="small"
              startIcon={uploading ? <CircularProgress size={14} color="inherit" /> : <AddPhotoIcon />}
              disabled={disabled || full}
              onClick={() => inputRef.current?.click()}
            >
              Add a photo
            </Button>
          </span>
        </Tooltip>
      </Stack>

      {photos.length > 0 && (
        <>
          <TextField
            size="small"
            label="Anything the photo doesn't show"
            placeholder="e.g. trace only the monogram, the card is 89 mm wide"
            value={hint}
            onChange={e => setHint(e.target.value)}
            multiline
            minRows={2}
            disabled={disabled || !available}
          />
          <Box>
            <Tooltip title={available
              ? 'The assistant proposes a drawing; nothing is applied until you accept it.'
              : 'The design assistant is not configured for this deployment.'}
            >
              <span>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <AutoAwesomeIcon />}
                  disabled={disabled || !available}
                  onClick={() => onTrace(photos.map(p => p.hash), hint.trim())}
                >
                  {busy ? 'Tracing…' : 'Trace to vector'}
                </Button>
              </span>
            </Tooltip>
          </Box>
        </>
      )}
    </Stack>
  )
}
