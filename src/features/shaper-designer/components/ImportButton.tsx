// File import. The picker is a hidden input rather than a drop zone because the
// canvas already owns drag-and-drop for the palette, and two drop targets in
// one panel is a coin toss for the user.
import { useCallback, useRef, useState } from 'react'
import { Button, CircularProgress } from '@mui/material'
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded'
import type { ImportFormat, SceneObject } from '../../../model/document.ts'
import { ACCEPT_ATTRIBUTE, importFile } from '../../../import/index.ts'
import { putAsset } from '../../../import/assetStore.ts'
import { newId } from '../../../model/scene.ts'
import { IDENTITY_TRANSFORM } from '../../../model/scene.ts'

export interface ImportButtonProps {
  formats: readonly ImportFormat[]
  /** 2D pages turn outlines into path objects; 3D pages also accept meshes. */
  accepts3d?: boolean
  onImported: (objects: SceneObject[]) => void
  onError: (message: string) => void
  label?: string
}

export default function ImportButton(props: ImportButtonProps) {
  const { formats, accepts3d = false, onImported, onError, label = 'Import' } = props
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)

  const handle = useCallback(async (file: File) => {
    setBusy(true)
    try {
      const result = await importFile(file)
      const base = {
        transform: IDENTITY_TRANSFORM,
        mode: 'solid' as const,
        visible: true,
        locked: false,
      }

      if (result.kind === '2d') {
        // Each closed region becomes its own object so it can be moved, given a
        // cut type, or deleted independently.
        const objects: SceneObject[] = result.regions.map((rings, i) => ({
          ...base,
          id: newId(),
          name: result.regions.length > 1 ? `${file.name} ${i + 1}` : file.name,
          type: 'path',
          rings,
          thicknessMm: 5,
          source: { format: result.format, filename: file.name },
          cut: { type: 'exterior' as const },
        }))
        onImported(objects)
        return
      }

      if (!accepts3d) {
        onError(`${file.name} is a 3D model; this designer works in 2D outlines.`)
        return
      }

      // The bytes stay in the browser: PRODUCT.md keeps fabrication data out of
      // the database, so the document carries only a content hash.
      const asset = await putAsset(await file.arrayBuffer(), file.name, result.format)
      onImported([{
        ...base,
        id: newId(),
        name: file.name,
        type: 'imported',
        format: result.format,
        asset,
      }])
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : `could not import ${file.name}`)
    } finally {
      setBusy(false)
    }
  }, [accepts3d, onImported, onError])

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE(formats)}
        hidden
        onChange={e => {
          const file = e.target.files?.[0]
          // Reset so re-picking the same file fires change again.
          e.target.value = ''
          if (file) void handle(file)
        }}
      />
      <Button
        size="small"
        disabled={busy}
        startIcon={busy ? <CircularProgress size={14} /> : <FileUploadRoundedIcon />}
        onClick={() => inputRef.current?.click()}
      >
        {label}
      </Button>
    </>
  )
}
