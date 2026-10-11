// What this workbench can print in today.
//
// Orders are the inventory. The page loads what was bought and what the
// printer used, and derives the shelf from the two (lib/contracts/
// filamentOrders.ts): rolls on hand, grams left, and what a kilogram of each
// colour cost. Nothing here is ticked; the one thing a person says on this page
// is that a roll ran out early.
//
// Each line lists what is on hand first, the most printed first, then the rest
// of the catalogue in its own order.
//
// Discontinued colours are hidden by default: more than half of PETG Basic is
// gone from the shop, and a page you shop from should show what you can buy.
// The ones you have bought are never hidden -- a spool outlives its listing.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import {
  FILAMENT_LINES, filamentsOfLine,
} from '../../../lib/contracts/bambuFilaments.ts'
import type { FilamentColor, FilamentLine } from '../../../lib/contracts/bambuFilaments.ts'
import { ErrorState, LoadingState } from '../../components/LoadingState.tsx'
import FilamentSection from './components/FilamentSection.tsx'
import FilamentSheet from './components/FilamentSheet.tsx'
import FilterBar from './components/FilterBar.tsx'
import type { StatusFilter } from './model/shelf.ts'
import { formatExactGrams, rollsLabel } from './model/shelf.ts'
import UsagePanel from './components/UsagePanel.tsx'
import { getFilamentUsage, getOrders, putUsageMappings, setRollsFinished } from './service.ts'
import type { OrderBook } from './service.ts'
import { sourceId } from '../../../lib/contracts/filamentUsage.ts'
import type {
  FilamentSource, FilamentUsageMapping, FilamentUsageReport,
} from '../../../lib/contracts/filamentUsage.ts'
import { ledgerOf, priceBookOf } from '../../../lib/contracts/filamentOrders.ts'
import type { ColorLedger } from '../../../lib/contracts/filamentOrders.ts'
import { stockOf } from '../../../lib/contracts/filamentStock.ts'
import { labelSheet } from './model/labels.ts'
import { XLSX_MIME, writeXlsx } from '../../export/xlsx.ts'
import { triggerDownload } from '../../export/download.ts'
import ReorderBanner from './components/ReorderBanner.tsx'
import AmsPanel from './components/AmsPanel.tsx'

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

/** Each colour with the line it belongs to, for opening its sheet by key. */
const ENTRY_BY_KEY = new Map<string, { id: string; line: FilamentLine; color: FilamentColor }>(
  SECTIONS.flatMap(section => section.colors.map(
    color => [color.key, { id: section.id, line: section.line, color }] as const)))

const LINE_CHOICES = SECTIONS.map(section => ({ id: section.id, line: section.line }))

const countColors = (sections: readonly Section[]): number =>
  sections.reduce((total, section) => total + section.colors.length, 0)

const ALL_COLORS = countColors(SECTIONS)

/** Where each colour sits in the catalogue, for the order after the shelf's own. */
const CATALOG_INDEX = new Map(SECTIONS.flatMap(section => section.colors.map(color => color.key))
  .map((key, index) => [key, index]))

export default function FilamentsPage() {
  const [book, setBook] = useState<OrderBook | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [marking, setMarking] = useState(false)
  const [hideDiscontinued, setHideDiscontinued] = useState(true)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [lineFilter, setLineFilter] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // The colours the sheet steps through, sampled when it opens: a filter that
  // re-ran under an open sheet would move the next colour out from under it.
  const [sheet, setSheet] = useState<{ keys: readonly string[]; index: number } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  // null: this account may not see usage, so the page shows without it.
  // undefined: not loaded yet, or it failed and `usageError` says why.
  const [usage, setUsage] = useState<FilamentUsageReport | null | undefined>(undefined)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)

  const load = useCallback(() => {
    setLoadError(null)
    setSaveError(null)
    let cancelled = false
    void getOrders()
      .then(result => { if (!cancelled) setBook(result) })
      .catch(error => { if (!cancelled) setLoadError(messageOf(error)) })
    // Separate on purpose. Usage is a second opinion on the page, and the
    // statistics history being unreachable must never hide what was bought.
    setUsageError(null)
    void getFilamentUsage()
      .then(result => { if (!cancelled) setUsage(result) })
      .catch(error => { if (!cancelled) setUsageError(messageOf(error)) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => load(), [load])

  const usageByKey = useMemo(
    () => (usage ? new Map(usage.colors.map(color => [color.key, color])) : undefined),
    [usage])

  const ledgers = useMemo<Map<string, ColorLedger>>(() => {
    if (!book) return new Map()
    const used = new Map((usage?.colors ?? []).map(color => [color.key, color.grams]))
    return ledgerOf(book.orders, used, book.adjustments)
  }, [book, usage])

  const priceOf = useMemo(() => priceBookOf(book?.orders ?? []), [book])

  const markFinished = useCallback((key: string, finished: number) => {
    setMarking(true)
    setSaveError(null)
    void setRollsFinished(key, Math.max(0, finished))
      .then(adjustments => setBook(previous => previous && { ...previous, adjustments }))
      .catch(error => setSaveError(messageOf(error)))
      .finally(() => setMarking(false))
  }, [])

  const saveMappings = useCallback((mappings: FilamentUsageMapping[]) => {
    setLinking(true)
    setUsageError(null)
    void putUsageMappings(mappings)
      .then(() => getFilamentUsage())
      .then(result => setUsage(result))
      .catch(error => setUsageError(messageOf(error)))
      .finally(() => setLinking(false))
  }, [])

  // "Don't track" from a colour's sheet: the same link the usage panel makes,
  // replacing any link that source already had.
  const untrack = useCallback((source: FilamentSource) => {
    if (!usage) return
    saveMappings([
      ...usage.mappings.filter(mapping => sourceId(mapping.source) !== sourceId(source)),
      { source, key: null },
    ])
  }, [usage, saveMappings])

  const stock = useMemo(() => {
    if (!usage?.ams) return []
    return stockOf(usage.ams, key => ledgers.get(key)?.rollsOnHand ?? 0)
  }, [usage, ledgers])

  const stockByKey = useMemo(() => new Map(stock.map(entry => [entry.key, entry])), [stock])

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
    const onHand = (key: string) => ledgers.get(key)?.rollsOnHand ?? 0
    const used = (key: string) => ledgers.get(key)?.usedGrams ?? 0
    const inStatus = (color: FilamentColor): boolean => {
      switch (status) {
        case 'owned': return onHand(color.key) > 0
        case 'missing': return onHand(color.key) === 0
        case 'loaded': return stockByKey.has(color.key)
        case 'used': return Boolean(usageByKey?.get(color.key)?.grams)
        default: return true
      }
    }
    // Bought ever, not just on hand: a discontinued colour you used up is
    // still part of your history.
    const bought = (key: string) => (ledgers.get(key)?.rolls.length ?? 0) > 0
    return SECTIONS
      .filter(section => lineFilter === null || section.id === lineFilter)
      .map(section => ({
        ...section,
        colors: section.colors
          .filter(color =>
            (!hideDiscontinued || !color.discontinued || bought(color.key))
            && matches(color)
            && inStatus(color))
          // On hand first; among those, and among the rest, the most printed
          // first; otherwise the catalogue's own order.
          .sort((a, b) =>
            Number(onHand(b.key) > 0) - Number(onHand(a.key) > 0)
            || used(b.key) - used(a.key)
            || (CATALOG_INDEX.get(a.key) ?? 0) - (CATALOG_INDEX.get(b.key) ?? 0)),
      }))
      .filter(section => section.colors.length > 0)
  }, [hideDiscontinued, search, status, lineFilter, ledgers, stockByKey, usageByKey])

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
    if (!book) return null
    let colors = 0
    let rolls = 0
    let grams = 0
    for (const ledger of ledgers.values()) {
      if (ledger.rollsOnHand > 0) colors += 1
      rolls += ledger.rollsOnHand
      grams += ledger.gramsAvailable
    }
    const shown = countColors(sections)
    return {
      colors, rolls, grams,
      hidden: ALL_COLORS - shown,
      // "Discontinued hidden" is only true when that switch is the only filter
      // on; a search, a type or a status holds back colours of every kind.
      filtered: Boolean(search.trim()) || status !== 'all' || lineFilter !== null,
    }
  }, [book, ledgers, sections, search, status, lineFilter])

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
    if (!sheet || !book) return null
    const found = ENTRY_BY_KEY.get(sheet.keys[sheet.index])
    if (!found) return null
    const key = found.color.key
    return {
      line: found.line,
      color: found.color,
      ledger: ledgers.get(key),
      stock: usage?.ams ? stockByKey.get(key) : undefined,
      usage: usageByKey?.get(key),
      price: priceOf(key),
    }
  }, [sheet, book, ledgers, usage, stockByKey, usageByKey, priceOf])

  return (
    <Stack spacing={2} sx={{ p: { xs: 0, sm: 1, md: 2.5 }, maxWidth: 1120, width: '100%' }}>
      <Box>
        <Typography variant="h1" component="h1">Filaments</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {summary ? (
            <>
              {rollsLabel(summary.rolls)} in {summary.colors} {summary.colors === 1 ? 'colour' : 'colours'}
              {summary.grams > 0 && <> · {formatExactGrams(summary.grams)} available</>}
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
          <Typography variant="body2">{saveError}</Typography>
        </Alert>
      )}

      {usageError && (
        <Alert severity="warning">
          <Typography variant="body2" sx={{ fontWeight: 600 }}>Print usage unavailable</Typography>
          <Typography variant="body2">{usageError}</Typography>
        </Alert>
      )}

      {book && book.orders.length === 0 && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h2" component="h2">Nothing on the shelf yet</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
            Your shelf is worked out from what you bought. Upload your Bambu Lab invoices, or add
            rolls you bought without one, and it fills in.
          </Typography>
          <Button variant="contained" component={RouterLink} to="/filaments/orders">
            Log your orders
          </Button>
        </Paper>
      )}

      {book && usage?.ams && <ReorderBanner stock={stock} receivedAt={usage.ams.receivedAt} />}

      {book && usage?.ams && <AmsPanel ams={usage.ams} stock={stockByKey} onOpen={openSheet} />}

      {loadError && <ErrorState message={loadError} onRetry={load} />}
      {!loadError && !book && <LoadingState label="Loading your filaments…" />}

      {book && (
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
          onShowDiscontinued={next => setHideDiscontinued(!next)}
          labelCount={shownColors.length}
          onLabels={exportLabels}
        />
      )}

      {book && sections.length === 0 && (
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

      {book && sections.map(section => (
        <FilamentSection
          key={section.id}
          id={section.id}
          line={section.line}
          colors={section.colors}
          ledgers={ledgers}
          stock={usage?.ams ? stockByKey : undefined}
          onOpen={openSheet}
        />
      ))}

      {book && usage && (
        <UsagePanel usage={usage} busy={linking} priceOf={priceOf} onMappings={saveMappings} />
      )}

      <FilamentSheet
        entry={sheetEntry}
        onClose={() => setSheet(null)}
        onFinished={markFinished}
        busy={marking}
        onUntrack={usage ? untrack : undefined}
        linking={linking}
        position={{ index: sheet?.index ?? 0, total: sheet?.keys.length ?? 0 }}
        onStep={stepSheet}
      />
    </Stack>
  )
}
