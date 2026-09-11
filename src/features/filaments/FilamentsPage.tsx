// What this workbench can print in today.
//
// The catalogue is compiled in; only the ticks travel. A tick is the commit --
// there is no Save button, because a dirty-guard over 165 checkboxes is
// friction nobody wants and a checkbox that does not mean anything until you
// press something else is a checkbox that lies.
//
// Ticks are applied optimistically and the whole inventory is queued for
// writing. If the write fails the page says so and offers a reload rather than
// silently diverging from what was stored.
//
// Discontinued colours are hidden by default: more than half of PETG Basic is
// gone from the shop, and a page you shop from should show what you can buy.
// The ones you own are never hidden -- the catalogue keeps dead SKUs precisely
// because a spool outlives its listing, and a tick you cannot see is a tick you
// cannot correct.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import {
  FILAMENT_CATALOG, FILAMENT_LINES, filamentsOfLine,
} from '../../../lib/contracts/bambuFilaments.ts'
import type {
  FilamentColor, FilamentLine, FilamentVariant,
} from '../../../lib/contracts/bambuFilaments.ts'
import { ErrorState, LoadingState } from '../../components/LoadingState.tsx'
import FilamentSection from './components/FilamentSection.tsx'
import { createInventoryWriter, getFilaments } from './service.ts'
import { setToTicks, tickId, ticksToSet } from './model/types.ts'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'The inventory could not be reached.'

interface Section {
  id: string
  line: FilamentLine
  colors: readonly FilamentColor[]
}

/** Each line with its colours, resolved once for the module rather than per render. */
const SECTIONS: readonly Section[] = FILAMENT_LINES.map(line => {
  const id = `${line.brand}/${line.material}/${line.type}`
  return { id, line, colors: filamentsOfLine(id) }
})

const VARIANTS_BY_KEY = new Map<string, readonly FilamentVariant[]>(
  SECTIONS.flatMap(section => section.colors.map(
    color => [color.key, section.line.variants] as const)))

const variantsOf = (key: string): readonly FilamentVariant[] => VARIANTS_BY_KEY.get(key) ?? []

const countOwned = (section: Section, owned: ReadonlySet<string>): number =>
  section.colors.reduce((total, color) => total + section.line.variants.reduce(
    (n, variant) => n + (owned.has(tickId(color.key, variant)) ? 1 : 0), 0), 0)

const countPairs = (sections: readonly Section[]): number => sections.reduce(
  (total, section) => total + section.colors.length * section.line.variants.length, 0)

const ALL_PAIRS = countPairs(SECTIONS)

/** The discontinued colours this inventory has a tick on, by colour key. */
const ownedDiscontinued = (owned: ReadonlySet<string>): Set<string> => new Set(
  FILAMENT_CATALOG
    .filter(color => color.discontinued
      && variantsOf(color.key).some(variant => owned.has(tickId(color.key, variant))))
    .map(color => color.key))

export default function FilamentsPage() {
  const [owned, setOwned] = useState<ReadonlySet<string> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [hideDiscontinued, setHideDiscontinued] = useState(true)
  // Which discontinued rows survive the filter. Sampled when the filter goes on
  // and when the inventory loads, never tracked live: a row that vanished the
  // instant you cleared its last tick would take with it the checkbox you were
  // in the middle of correcting.
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set<string>())

  const writerRef = useRef<ReturnType<typeof createInventoryWriter> | null>(null)
  if (!writerRef.current) {
    writerRef.current = createInventoryWriter(error => setSaveError(messageOf(error)))
  }

  const load = useCallback(() => {
    setLoadError(null)
    setSaveError(null)
    let cancelled = false
    void getFilaments()
      .then(ticks => {
        if (cancelled) return
        const set = ticksToSet(ticks)
        setKept(ownedDiscontinued(set))
        setOwned(set)
      })
      .catch(error => { if (!cancelled) setLoadError(messageOf(error)) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => load(), [load])

  const toggle = useCallback((key: string, variant: FilamentVariant, next: boolean) => {
    setOwned(previous => {
      if (!previous) return previous
      const updated = new Set(previous)
      if (next) updated.add(tickId(key, variant))
      else updated.delete(tickId(key, variant))
      // Queued, not awaited: the checkbox has already moved, and the writer
      // coalesces so a fast run of ticks is not a fast run of requests.
      void writerRef.current?.save(setToTicks(updated, FILAMENT_CATALOG, variantsOf))
      return updated
    })
    setSaveError(null)
  }, [])

  const hide = useCallback((next: boolean) => {
    if (next && owned) setKept(ownedDiscontinued(owned))
    setHideDiscontinued(next)
  }, [owned])

  const sections = useMemo(() => {
    if (!hideDiscontinued) return SECTIONS
    return SECTIONS
      .map(section => ({
        ...section,
        colors: section.colors.filter(color => !color.discontinued || kept.has(color.key)),
      }))
      .filter(section => section.colors.length > 0)
  }, [hideDiscontinued, kept])

  const summary = useMemo(() => {
    if (!owned) return null
    const shown = countPairs(sections)
    return {
      total: owned.size,
      shown,
      hidden: ALL_PAIRS - shown,
      perLine: sections.map(section =>
        `${section.line.label} ${countOwned(section, owned)}/`
        + `${section.colors.length * section.line.variants.length}`),
    }
  }, [owned, sections])

  return (
    <Stack spacing={2} sx={{ p: { xs: 1.5, md: 2.5 }, maxWidth: 900, width: '100%' }}>
      <Box>
        <Typography variant="h1" component="h1">Filaments</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Tick what you own. Every Bambu Lab spool and refill the catalogue lists.
        </Typography>
      </Box>

      {/* The counts are a title block, not the point of the page. The filter
          sits with them because it is what the counts are counting. */}
      {summary && (
        <Stack
          direction="row"
          sx={{
            alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {summary.total} of {summary.shown} owned
            {summary.hidden > 0 && <> · {summary.hidden} discontinued hidden</>}
            {summary.total > 0 && <> · {summary.perLine.join(' · ')}</>}
          </Typography>
          <FormControlLabel
            sx={{ mr: 0 }}
            control={(
              <Switch
                size="small"
                checked={hideDiscontinued}
                onChange={event => hide(event.target.checked)}
                // A toggle, not one more of the 165 checkboxes below it: said
                // as "switch, on" rather than "checkbox, checked".
                slotProps={{ input: { role: 'switch' } }}
              />
            )}
            label={(
              <Typography variant="body2">Hide discontinued</Typography>
            )}
          />
        </Stack>
      )}

      {saveError && (
        <Alert severity="warning">
          <Typography variant="body2" sx={{ fontWeight: 600 }}>Not saved</Typography>
          <Typography variant="body2">
            {saveError} Your ticks are still on screen but were not stored — reload to see
            what is.
          </Typography>
        </Alert>
      )}

      {loadError && <ErrorState message={loadError} onRetry={load} />}
      {!loadError && !owned && <LoadingState label="Loading your filaments…" />}

      {owned && sections.map(section => (
        <FilamentSection
          key={section.id}
          line={section.line}
          colors={section.colors}
          owned={owned}
          onToggle={toggle}
        />
      ))}
    </Stack>
  )
}
