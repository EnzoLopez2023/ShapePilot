// The parts that ship with the app. Clicking one drops it at the origin, the
// same gesture as a solid; the fetch and the store happen behind the spinner.
import { Stack } from '@mui/material'
import PaletteRow from './PaletteRow.tsx'
import type { LibraryEntry } from './libraryEntries.ts'
import { LIBRARY } from './libraryEntries.ts'

export interface LibraryPaletteProps {
  /** Id of the entry currently being fetched, if any. */
  busyId: string | null
  onAdd: (entry: LibraryEntry) => void
}

export default function LibraryPalette({ busyId, onAdd }: LibraryPaletteProps) {
  return (
    <Stack spacing={0.25} role="list" aria-label="Parts">
      {LIBRARY.map(entry => (
        <PaletteRow
          key={entry.id}
          icon={entry.icon}
          label={entry.label}
          hint={entry.hint}
          busy={busyId === entry.id}
          disabled={busyId !== null}
          onAdd={() => onAdd(entry)}
        />
      ))}
    </Stack>
  )
}
