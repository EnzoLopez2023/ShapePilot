// What this workbench can print in today.
//
// The catalogue is compiled in; only the ticks travel. A tick is the commit --
// there is no Save button, because a dirty-guard over ~190 ticks is
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
import { Alert, Box, Stack, Typography } from '@mui/material'
import {
  FILAMENT_CATALOG, FILAMENT_LINES, filamentsOfLine,
} from '../../../lib/contracts/bambuFilaments.ts'
import type {
  FilamentColor, FilamentLine, FilamentVariant,
} from '../../../lib/contracts/bambuFilaments.ts'
import { ErrorState, LoadingState } from '../../components/LoadingState.tsx'
import FilamentSection from './components/FilamentSection.tsx'
import { quantitiesOf } from './model/shelf.ts'
import FilamentSheet from './components/FilamentSheet.tsx'
import FilterBar from './components/FilterBar.tsx'
import type { StatusFilter } from './model/shelf.ts'
import PricesDialog from './components/PricesDialog.tsx'
import UsagePanel from './components/UsagePanel.tsx'
import {
  createInventoryWriter, getFilamentPrices, getFilamentUsage, getFilaments, putFilamentPrices,
  putUsageMappings,
} from './service.ts'
import type { FilamentPrice } from './service.ts'
import type {
  FilamentUsageMapping, FilamentUsageReport,
} from '../../../lib/contracts/filamentUsage.ts'
import {
  MAX_QUANTITY, inventoryToTicks, ownedByColor, tickId, ticksToInventory, totalRolls,
} from './model/types.ts'
import { stockOf } from '../../../lib/contracts/filamentStock.ts'
import { labelSheet } from './model/labels.ts'
import { XLSX_MIME, writeXlsx } from '../../export/xlsx.ts'
import { triggerDownload } from '../../export/download.ts'
import ReorderBanner from './components/ReorderBanner.tsx'
import AmsPanel from './components/AmsPanel.tsx'
import type { Inventory } from './model/types.ts'

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

/** Each colour with the line it belongs to, for opening its sheet by key. */
const ENTRY_BY_KEY = new Map<string, { id: string; line: FilamentLine; color: FilamentColor }>(
  SECTIONS.flatMap(section => section.colors.map(
    color => [color.key, { id: section.id, line: section.line, color }] as const)))

const LINE_CHOICES = SECTIONS.map(section => ({ id: section.id, line: section.line }))

const countPairs = (sections: readonly Section[]): number => sections.reduce(
  (total, section) => total + section.colors.length * section.line.variants.length, 0)

const ALL_PAIRS = countPairs(SECTIONS)

/** The discontinued colours this inventory has a tick on, by colour key. */
const ownedDiscontinued = (owned: Inventory): Set<string> => new Set(
  FILAMENT_CATALOG
    .filter(color => color.discontinued
      && variantsOf(color.key).some(variant => owned.has(tickId(color.key, variant))))
    .map(color => color.key))

export default function FilamentsPage() {
  const [owned, setOwned] = useState<Inventory | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [hideDiscontinued, setHideDiscontinued] = useState(true)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [lineFilter, setLineFilter] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // The colours the sheet steps through, sampled when it opens: a filter that
  // re-ran under an open sheet would move the next colour out from under it.
  const [sheet, setSheet] = useState<{ keys: readonly string[]; index: number } | null>(null)
  const [pricesOpen, setPricesOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  // null: this account may not see usage, so the page shows without it.
  // undefined: not loaded yet, or it failed and `usageError` says why.
  const [usage, setUsage] = useState<FilamentUsageReport | null | undefined>(undefined)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  // Which discontinued rows survive the filter. Sampled when the filter goes on
  // and when the inventory loads, never tracked live: a row that vanished the
  // instant you cleared its last tick would take with it the checkbox you were
  // in the middle of correcting.
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set<string>())
  // What a kilogram of each line costs, and the currency they are priced in.
  // Absent until the account says; nothing here guesses a price or a currency.
  const [prices, setPrices] = useState<FilamentPrice[]>([])
  const [currency, setCurrency] = useState<string | null>(null)
  const [priceError, setPriceError] = useState<string | null>(null)

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
        const inventory = ticksToInventory(ticks)
        setKept(ownedDiscontinued(inventory))
        setOwned(inventory)
      })
      .catch(error => { if (!cancelled) setLoadError(messageOf(error)) })
    // Separate from the inventory on purpose. Usage is a second opinion on the
    // page, and the statistics history being unreachable must never stop
    // anyone ticking a spool.
    void getFilamentPrices()
      .then(stored => {
        if (cancelled) return
        setPrices(stored)
        if (stored.length) setCurrency(stored[0].currency)
      })
      .catch(error => { if (!cancelled) setPriceError(messageOf(error)) })
    setUsageError(null)
    void getFilamentUsage()
      .then(result => { if (!cancelled) setUsage(result) })
      .catch(error => { if (!cancelled) setUsageError(messageOf(error)) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => load(), [load])

  /**
   * Set how many of one filament in one form are owned. Zero removes the tick.
   * Ticking a box is `1`, unticking is `0`, and the stepper is anything between.
   */
  const setQuantity = useCallback((key: string, variant: FilamentVariant, quantity: number) => {
    setOwned(previous => {
      if (!previous) return previous
      const updated = new Map(previous)
      const clamped = Math.max(0, Math.min(MAX_QUANTITY, Math.round(quantity)))
      if (clamped === 0) updated.delete(tickId(key, variant))
      else updated.set(tickId(key, variant), clamped)
      // Queued, not awaited: the control has already moved, and the writer
      // coalesces so a fast run of ticks or steps is not a fast run of requests.
      void writerRef.current?.save(inventoryToTicks(updated, FILAMENT_CATALOG, variantsOf))
      return updated
    })
    setSaveError(null)
  }, [])

  /** Prices are replaced wholesale, like the inventory: edit one, send them all. */
  const savePrices = useCallback((next: FilamentPrice[]) => {
    setPrices(next)
    setPriceError(null)
    void putFilamentPrices(next)
      .then(stored => {
        setPrices(stored)
        if (!stored.length) setCurrency(previous => previous)
      })
      .catch(error => setPriceError(messageOf(error)))
  }, [])

  const setLinePrice = useCallback((line: string, pricePerKg: number | null) => {
    if (!currency) return
    setPrices(previous => {
      const next = previous.filter(price => price.line !== line)
      if (pricePerKg !== null) next.push({ line, pricePerKg, currency })
      const sorted = next.sort((a, b) => a.line < b.line ? -1 : a.line > b.line ? 1 : 0)
      savePrices(sorted)
      return sorted
    })
  }, [currency, savePrices])

  const changeCurrency = useCallback((next: string) => {
    setCurrency(next)
    // Prices are amounts in one currency; re-stamping them is the only honest
    // option short of converting, which nothing here does.
    if (prices.length) savePrices(prices.map(price => ({ ...price, currency: next })))
  }, [prices, savePrices])

  const priceByLine = useMemo(
    () => new Map(prices.map(price => [price.line, price.pricePerKg])), [prices])

  const saveMappings = useCallback((mappings: FilamentUsageMapping[]) => {
    setLinking(true)
    setUsageError(null)
    void putUsageMappings(mappings)
      .then(() => getFilamentUsage())
      .then(result => setUsage(result))
      .catch(error => setUsageError(messageOf(error)))
      .finally(() => setLinking(false))
  }, [])

  const usageByKey = useMemo(
    () => (usage ? new Map(usage.colors.map(color => [color.key, color])) : undefined),
    [usage])

  // Against the inventory being edited, not the one last saved: stepping a count
  // up clears its warning the moment it is pressed.
  const stock = useMemo(() => {
    if (!usage?.ams || !owned) return []
    const totals = ownedByColor(owned)
    return stockOf(usage.ams, key => totals.get(key) ?? 0)
  }, [usage, owned])

  const stockByKey = useMemo(() => new Map(stock.map(entry => [entry.key, entry])), [stock])

  const hide = useCallback((next: boolean) => {
    if (next && owned) setKept(ownedDiscontinued(owned))
    setHideDiscontinued(next)
  }, [owned])

  // `/` is the shorthand every list with a search box has; it must not steal
  // the key from a field someone is already typing in.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key !== '/' || target?.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const sections = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const matches = (color: FilamentColor) =>
      !needle
      || color.name.toLowerCase().includes(needle)
      || (color.code ?? '').toLowerCase().includes(needle)
    const ownsAny = (section: Section, color: FilamentColor) => !owned
      || section.line.variants.some(variant => owned.has(tickId(color.key, variant)))
    const inStatus = (section: Section, color: FilamentColor): boolean => {
      switch (status) {
        case 'owned': return ownsAny(section, color)
        case 'missing': return !owned || !ownsAny(section, color)
        case 'loaded': return stockByKey.has(color.key)
        case 'used': return Boolean(usageByKey?.get(color.key)?.grams)
        default: return true
      }
    }
    return SECTIONS
      .filter(section => lineFilter === null || section.id === lineFilter)
      .map(section => ({
        ...section,
        colors: section.colors.filter(color =>
          (!hideDiscontinued || !color.discontinued || kept.has(color.key))
          && matches(color)
          && inStatus(section, color)),
      }))
      .filter(section => section.colors.length > 0)
  }, [hideDiscontinued, kept, search, status, lineFilter, owned, stockByKey, usageByKey])

  // Exactly the rows on screen, so the filters above are what choose them:
  // flip Owned only and the sheet is your shelf. The count is in the button
  // rather than in a confirmation, because the answer to "how many labels is
  // that" should be visible before the click, not after it.
  const shownColors = useMemo(() => sections.flatMap(section => section.colors), [sections])

  const exportLabels = useCallback(() => {
    const rows = labelSheet(shownColors)
    triggerDownload(writeXlsx(rows, 'Filaments'), 'filament-labels.xlsx', XLSX_MIME)
  }, [shownColors])

  const summary = useMemo(() => {
    if (!owned) return null
    const shown = countPairs(sections)
    return {
      total: owned.size,
      rolls: totalRolls(owned),
      shown,
      hidden: ALL_PAIRS - shown,
      // "Discontinued hidden" is only true when that switch is the only filter
      // on; a search, a type or a status holds back rows of every kind.
      filtered: Boolean(search.trim()) || status !== 'all' || lineFilter !== null,
    }
  }, [owned, sections, search, status, lineFilter])

  const statuses = useMemo<StatusFilter[]>(() => [
    'all', 'owned', 'missing',
    ...(usage?.ams ? ['loaded' as const] : []),
    ...(usage ? ['used' as const] : []),
  ], [usage])

  const clearFilters = useCallback(() => {
    setSearch('')
    setStatus('all')
    setLineFilter(null)
  }, [])

  const openSheet = useCallback((key: string) => {
    const keys = shownColors.map(color => color.key)
    const index = keys.indexOf(key)
    // A colour opened from the AMS may be filtered out of the shelf; it still
    // opens, on its own.
    setSheet(index >= 0 ? { keys, index } : { keys: [key], index: 0 })
  }, [shownColors])

  const stepSheet = useCallback((delta: -1 | 1) => {
    setSheet(previous => previous && {
      ...previous,
      index: Math.max(0, Math.min(previous.keys.length - 1, previous.index + delta)),
    })
  }, [])

  const sheetEntry = useMemo(() => {
    if (!sheet || !owned) return null
    const found = ENTRY_BY_KEY.get(sheet.keys[sheet.index])
    if (!found) return null
    return {
      line: found.line,
      color: found.color,
      quantities: quantitiesOf(owned, found.color.key),
      stock: usage?.ams ? stockByKey.get(found.color.key) : undefined,
      usage: usageByKey?.get(found.color.key),
      pricePerKg: priceByLine.get(found.id) ?? null,
    }
  }, [sheet, owned, usage, stockByKey, usageByKey, priceByLine])

  return (
    <Stack spacing={2} sx={{ p: { xs: 0, sm: 1, md: 2.5 }, maxWidth: 1120, width: '100%' }}>
      <Box>
        <Typography variant="h1" component="h1">Filaments</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {summary ? (
            <>
              {summary.total} of {summary.shown} owned
              {summary.rolls > summary.total && <> ({summary.rolls} rolls)</>}
              {summary.hidden > 0 && (
                summary.filtered
                  ? <> · {summary.hidden} not shown</>
                  : <> · {summary.hidden} discontinued hidden</>
              )}
            </>
          ) : 'Every Bambu Lab spool and refill the catalogue lists.'}
        </Typography>
      </Box>

      {saveError && (
        <Alert severity="warning">
          <Typography variant="body2" sx={{ fontWeight: 600 }}>Not saved</Typography>
          <Typography variant="body2">
            {saveError} Your ticks are still on screen but were not stored — reload to see
            what is.
          </Typography>
        </Alert>
      )}

      {priceError && (
        <Alert severity="warning">
          <Typography variant="body2" sx={{ fontWeight: 600 }}>Prices not saved</Typography>
          <Typography variant="body2">{priceError}</Typography>
        </Alert>
      )}

      {usageError && (
        <Alert severity="warning">
          <Typography variant="body2" sx={{ fontWeight: 600 }}>Print usage unavailable</Typography>
          <Typography variant="body2">{usageError}</Typography>
        </Alert>
      )}

      {owned && usage?.ams && <ReorderBanner stock={stock} receivedAt={usage.ams.receivedAt} />}

      {owned && usage?.ams && <AmsPanel ams={usage.ams} stock={stockByKey} onOpen={openSheet} />}

      {loadError && <ErrorState message={loadError} onRetry={load} />}
      {!loadError && !owned && <LoadingState label="Loading your filaments…" />}

      {owned && (
        <FilterBar
          search={search}
          onSearch={setSearch}
          searchRef={searchRef}
          lines={LINE_CHOICES}
          line={lineFilter}
          onLine={setLineFilter}
          status={status}
          onStatus={setStatus}
          statuses={statuses}
          showDiscontinued={!hideDiscontinued}
          onShowDiscontinued={next => hide(!next)}
          labelCount={shownColors.length}
          onLabels={exportLabels}
          onPrices={() => setPricesOpen(true)}
        />
      )}

      {owned && sections.length === 0 && (
        <Stack sx={{ alignItems: 'center', gap: 1, py: 4 }}>
          <Typography variant="body2" color="text.secondary">
            No colour matches those filters.
          </Typography>
          <Box
            component="button"
            type="button"
            onClick={clearFilters}
            sx={{
              all: 'unset', cursor: 'pointer', color: 'primary.main', fontWeight: 600,
              fontSize: '0.8125rem', borderRadius: '6px',
            }}
          >
            Clear filters
          </Box>
        </Stack>
      )}

      {owned && sections.map(section => (
        <FilamentSection
          key={section.id}
          id={section.id}
          line={section.line}
          colors={section.colors}
          owned={owned}
          usage={usageByKey}
          stock={usage?.ams ? stockByKey : undefined}
          pricePerKg={priceByLine.get(section.id) ?? null}
          currency={currency}
          onOpen={openSheet}
        />
      ))}

      {owned && usage && (
        <UsagePanel usage={usage} busy={linking} prices={prices} onMappings={saveMappings} />
      )}

      <FilamentSheet
        entry={sheetEntry}
        onClose={() => setSheet(null)}
        onQuantity={setQuantity}
        currency={currency}
        position={{ index: sheet?.index ?? 0, total: sheet?.keys.length ?? 0 }}
        onStep={stepSheet}
      />

      <PricesDialog
        open={pricesOpen}
        onClose={() => setPricesOpen(false)}
        lines={LINE_CHOICES}
        priceByLine={priceByLine}
        currency={currency}
        onCurrency={changeCurrency}
        onPrice={setLinePrice}
      />
    </Stack>
  )
}
