// Photographs of the keycap set, and the button that reads them.
//
// The picker is a hidden input behind a Button, the same choice
// ImportButton.tsx made for geometry: the page has no other drop target, and a
// drop zone that only appears in one panel is a coin toss for the user.
//
// Bytes go up through the ordinary asset route first; the project only records
// the resulting content hash. That is what keeps the JSON bodies small and the
// photo out of the backup manifest, where it does not belong.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box, Button, CircularProgress, IconButton, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import AddPhotoIcon from '@mui/icons-material/AddPhotoAlternateOutlined'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeRounded'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import { fetchAsset, uploadAsset } from '../../../services/designAssets.ts'
import { hashBytes } from '../../../import/assetStore.ts'
import { errorMessage } from '../../../services/errors.ts'
import { EmptyState } from '../../../components/LoadingState.tsx'
import { MAX_PHOTO_BYTES, PHOTO_ACCEPT, preparePhoto } from '../../../import/preparePhoto.ts'
import type { ProjectPhoto } from '../model/types.ts'

/** Matches the server's own cap; see LIMITS.maxPhotos in
 *  server/validation/keycapProject.ts. */
export const MAX_PHOTOS = 12

export interface PhotoPanelProps {
  photos: ProjectPhoto[]
  /** Absent while the project has never been saved -- nothing to attach to. */
  projectId: string | null
  busy: boolean
  aiAvailable: boolean
  onAttach: (hash: string, caption?: string) => Promise<void>
  onRemove: (hash: string) => Promise<void>
  onRead: (hint: string) => Promise<void>
  onError: (message: string) => void
}

export default function PhotoPanel(props: PhotoPanelProps) {
  const { photos, projectId, busy, aiAvailable, onAttach, onRemove, onRead, onError } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [hint, setHint] = useState('')

  const pick = useCallback(async (file: File) => {
    setUploading(true)
    try {
      const prepared = await preparePhoto(file)
      const hash = await hashBytes(prepared.bytes)
      await uploadAsset(hash, prepared.bytes, prepared.filename, prepared.format)
      await onAttach(hash, file.name)
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setUploading(false)
    }
  }, [onAttach, onError])

  const full = photos.length >= MAX_PHOTOS
  const disabled = busy || uploading || !projectId

  return (
    <Stack spacing={1.25} sx={{ minHeight: 0 }}>
      <input
        type="file"
        hidden
        ref={inputRef}
        accept={PHOTO_ACCEPT}
        onChange={e => {
          const file = e.target.files?.[0]
          // Reset first, so re-picking the same file fires change again.
          e.target.value = ''
          if (file) void pick(file)
        }}
      />

      {!photos.length
        ? (
          <EmptyState
            title="No photos yet"
            description={projectId
              ? 'Add a picture of the set and the assistant can read the caps off it.'
              : 'Save the project first, then add photos of the set.'}
          />
        )
        : (
          <Box
            component="ul"
            sx={{
              listStyle: 'none', m: 0, p: 0,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 0.75,
            }}
          >
            {photos.map(photo => (
              <Thumbnail
                key={photo.hash}
                photo={photo}
                disabled={disabled}
                onRemove={() => void onRemove(photo.hash)}
              />
            ))}
          </Box>
        )}

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        <Tooltip title={full
          ? `A project holds at most ${MAX_PHOTOS} photos.`
          : 'Pictures are scaled down before they are stored.'}
        >
          <span>
            <Button
              size="small"
              startIcon={uploading
                ? <CircularProgress size={14} color="inherit" />
                : <AddPhotoIcon />}
              disabled={disabled || full}
              onClick={() => inputRef.current?.click()}
            >
              Add a photo
            </Button>
          </span>
        </Tooltip>
      </Stack>

      {photos.length > 0 && (
        <Stack spacing={1}>
          <TextField
            size="small"
            label="Anything the photos do not show"
            placeholder="e.g. this is only the base kit, the numpad is a separate set"
            value={hint}
            onChange={e => setHint(e.target.value)}
            multiline
            minRows={2}
            disabled={disabled || !aiAvailable}
          />
          <Box>
            <Tooltip title={aiAvailable
              ? 'The assistant proposes an inventory; nothing is saved until you apply it.'
              : 'The design assistant is not configured for this deployment.'}
            >
              <span>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<AutoAwesomeIcon />}
                  disabled={disabled || !aiAvailable}
                  onClick={() => void onRead(hint)}
                >
                  Read the photos
                </Button>
              </span>
            </Tooltip>
          </Box>
        </Stack>
      )}
    </Stack>
  )
}

/**
 * The bytes are content-addressed and never change, so one fetch per hash per
 * mount is enough. Revoked on unmount: an object URL that outlives its <img> is
 * a leak the browser cannot see.
 */
function Thumbnail(
  { photo, disabled, onRemove }: { photo: ProjectPhoto; disabled: boolean; onRemove: () => void },
) {
  const [url, setUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let objectUrl: string | null = null
    let live = true
    void (async () => {
      const bytes = await fetchAsset(photo.hash).catch(() => null)
      if (!live) return
      // Metadata without bytes is an ordinary state: assets sit outside the
      // backup manifest, so a photo can legitimately be gone.
      if (!bytes) { setMissing(true); return }
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
      setUrl(objectUrl)
    })()
    return () => {
      live = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [photo.hash])

  return (
    <Box
      component="li"
      sx={{
        position: 'relative', borderRadius: 2, overflow: 'hidden',
        border: 1, borderColor: 'divider', aspectRatio: '4 / 3',
        bgcolor: 'background.default',
      }}
    >
      {url
        ? (
          <Box
            component="img"
            src={url}
            alt={photo.caption ?? 'A photo of the keycap set'}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )
        : (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ p: 1, display: 'block' }}
          >
            {missing ? 'Not on this server — add it again' : 'Loading…'}
          </Typography>
        )}
      <IconButton
        size="small"
        aria-label={`Remove ${photo.caption ?? 'this photo'}`}
        disabled={disabled}
        onClick={onRemove}
        sx={{
          position: 'absolute', top: 4, right: 4,
          bgcolor: 'background.paper',
          '&:hover': { bgcolor: 'background.paper' },
        }}
      >
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

export { MAX_PHOTO_BYTES }
