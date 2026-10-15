// A Library thumbnail. The bytes sit behind the API, so an <img src> cannot
// fetch them with the bearer token; each hash is fetched once as a blob and its
// object URL kept for the life of the page. Hashes name bytes, so a cached
// URL can never go stale.
import { useEffect, useState } from 'react'
import { Box } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import ViewInArRoundedIcon from '@mui/icons-material/ViewInArRounded'
import { getThumb } from '../service.ts'

const cache = new Map<string, Promise<string | null>>()

function thumbUrl(hash: string): Promise<string | null> {
  let pending = cache.get(hash)
  if (!pending) {
    pending = getThumb(hash).then(blob => URL.createObjectURL(blob)).catch(() => {
      // A failed fetch is forgotten, so the next mount can try again.
      cache.delete(hash)
      return null
    })
    cache.set(hash, pending)
  }
  return pending
}

export interface LibraryThumbProps {
  hash: string | null
  alt?: string
  iconSize?: number
  fit?: 'cover' | 'contain'
  sx?: SxProps<Theme>
}

export function LibraryThumb({ hash, alt = '', iconSize = 40, fit = 'cover', sx }: LibraryThumbProps) {
  const [url, setUrl] = useState<{ hash: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!hash) return
    let live = true
    void thumbUrl(hash).then(next => { if (live) setUrl({ hash, url: next }) })
    return () => { live = false }
  }, [hash])

  const src = url && url.hash === hash ? url.url : null
  return (
    <Box
      sx={[{
        display: 'grid', placeItems: 'center', overflow: 'hidden',
        bgcolor: 'action.hover', color: 'text.disabled', width: '100%', height: '100%',
      }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {src
        ? <Box component="img" src={src} alt={alt} sx={{ width: '100%', height: '100%', objectFit: fit }} />
        : <ViewInArRoundedIcon aria-hidden="true" sx={{ fontSize: iconSize }} />}
    </Box>
  )
}
