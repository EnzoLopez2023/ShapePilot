// What was bought, which is what is on the shelf.
//
// Two ways in. A Bambu Lab US invoice is read in the browser and shown for
// review before anything is saved; once the order is saved, the PDF is kept
// with it for reference. Rolls with no invoice (a shop counter, a gift) are
// added by hand. Either way the result is an order, and the Filaments page
// works out rolls on hand, grams left and price per kilogram from the orders.
//
// An order is not edited in place. A wrong one is deleted and logged again,
// which is what correcting a receipt is.
//
// It is also the purchase history: each order shows everything on it -- the
// hotend and the glue sticks as well as the filament -- and how the invoice
// reached what was paid, and keeps the original invoice to open again. A paper
// receipt can be kept as a photo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Button, Collapse, IconButton, Link, Paper, Stack, Tooltip, Typography,
} from '@mui/material'
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined'
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import { filamentByKey } from '../../../lib/contracts/bambuFilaments.ts'
import { InvoiceParseError, parseBambuInvoice } from '../../../lib/contracts/bambuInvoice.ts'
import { landedCosts, orderSummary, rollsOf } from '../../../lib/contracts/filamentOrders.ts'
import type { FilamentOrder, FilamentOrderInput } from '../../../lib/contracts/filamentOrders.ts'
import { ErrorState, LoadingState, EmptyState } from '../../components/LoadingState.tsx'
import { useConfirm } from '../../components/ConfirmDialogProvider.tsx'
import { createOrder, deleteOrder, fetchInvoice, getOrders, uploadInvoice } from './service.ts'
import type { OrderBook } from './service.ts'
import { pdfTextItems } from './model/pdfText.ts'
import { colorLabel } from './model/usage.ts'
import { formatMoney } from './model/cost.ts'
import { formatExactGrams, rollsLabel } from './model/shelf.ts'
import InvoiceReviewDialog from './components/InvoiceReviewDialog.tsx'
import { saveable } from './model/invoiceProposal.ts'
import type { InvoiceProposal } from './model/invoiceProposal.ts'
import ManualOrderDialog from './components/ManualOrderDialog.tsx'
import { SpoolArt } from './components/SpoolArt.tsx'
import { ApiRequestError } from '../../services/errors.ts'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'The orders could not be reached.'

const formatDate = (iso: string): string => {
  const date = new Date(`${iso}T12:00:00`)
  return Number.isNaN(date.getTime()) ? iso
    : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

/** The order as the server takes it: the reader's own bookkeeping stays behind. */
const toInput = (order: FilamentOrderInput): FilamentOrderInput => ({
  ...order,
  lines: order.lines.map(line => ({
    key: line.key,
    description: line.description,
    sku: line.sku,
    variant: line.key ? line.variant : null,
    gramsPerUnit: line.key ? line.gramsPerUnit : 0,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discount: line.discount,
    tax: line.tax,
  })),
})

function MoneyRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="body2" color={strong ? 'text.primary' : 'text.secondary'} sx={{ fontWeight: strong ? 650 : undefined }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: strong ? 650 : undefined }}>
        {value}
      </Typography>
    </Stack>
  )
}

interface OrderCardProps {
  order: FilamentOrder
  onDelete: () => void
  onOpenInvoice: () => void
  onAttach: (file: File) => void
  attaching: boolean
}

function OrderCard({ order, onDelete, onOpenInvoice, onAttach, attaching }: OrderCardProps) {
  const [open, setOpen] = useState(false)
  const attachRef = useRef<HTMLInputElement>(null)
  const costs = landedCosts(order)
  const summary = orderSummary(order)
  const money = (amount: number) => formatMoney(amount, order.currency)
  const filament = order.lines
    .map((line, index) => ({ line, cost: costs[index] }))
    .filter(entry => entry.line.key)
  const rolls = filament.reduce((sum, entry) => sum + entry.line.quantity, 0)
  const others = order.lines.filter(line => !line.key)
  const priced = order.lines.some(line => line.unitPrice !== null)
  const title = order.source === 'manual'
    ? (order.note ?? 'Without an invoice')
    : `Order ${order.orderNumber}`
  const detailsId = `order-details-${order.id}`

  return (
    <Paper component="section" aria-label={`${formatDate(order.orderedAt)}, ${title}`} sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h3" component="h2" sx={{ overflowWrap: 'anywhere' }}>
            {formatDate(order.orderedAt)}
            {priced && (
              <Box component="span" sx={{ fontWeight: 500, color: 'text.secondary' }}> · {money(summary.paid)}</Box>
            )}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {title} · {rollsLabel(rolls)}
            {priced && summary.filament > 0 && <> · {money(summary.filament)} of filament</>}
            {others.length > 0 && <> · {others.length} other {others.length === 1 ? 'item' : 'items'}</>}
          </Typography>
        </Box>
        <Tooltip title="Delete this order">
          <IconButton aria-label={`Delete ${title}`} onClick={onDelete}>
            <DeleteOutlineRoundedIcon />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box
        component="ul"
        sx={{
          listStyle: 'none', p: 0, m: 0, mt: 1.25,
          display: 'grid', gap: 1,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(260px, 1fr))' },
        }}
      >
        {filament.map(({ line, cost }, index) => {
          const color = filamentByKey(line.key!)
          return (
            <Stack key={index} component="li" direction="row" sx={{ alignItems: 'center', gap: 1.25, minWidth: 0 }}>
              <SpoolArt hexes={color?.hexes ?? ['#8A9096']} variant={line.variant ?? 'spool'} size={30} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                  {colorLabel(line.key!).split(' · ')[1] ?? colorLabel(line.key!)}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                  {colorLabel(line.key!).split(' · ')[0]} · {line.variant === 'refill' ? 'Refill' : 'With spool'}
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {line.quantity} × {cost === null ? '—' : money(cost / line.quantity)}
              </Typography>
            </Stack>
          )
        })}
      </Box>

      <Stack direction="row" sx={{ gap: 1, mt: 1.25, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          size="small"
          color="inherit"
          aria-expanded={open}
          aria-controls={detailsId}
          endIcon={<ExpandMoreRoundedIcon sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />}
          onClick={() => setOpen(value => !value)}
        >
          {open ? 'Hide details' : 'Every item and total'}
        </Button>
        {order.invoice ? (
          <Button size="small" color="inherit" startIcon={<ReceiptLongOutlinedIcon />} onClick={onOpenInvoice}>
            {order.invoice.contentType === 'application/pdf' ? 'Invoice' : 'Receipt'}
          </Button>
        ) : (
          <>
            <input
              ref={attachRef}
              type="file"
              accept="application/pdf,.pdf,image/png,image/jpeg"
              hidden
              aria-label={`Invoice or receipt for ${title}`}
              onChange={event => {
                const file = event.target.files?.[0]
                if (file) onAttach(file)
                event.target.value = ''
              }}
            />
            <Button
              size="small"
              color="inherit"
              startIcon={<AttachFileRoundedIcon />}
              disabled={attaching}
              onClick={() => attachRef.current?.click()}
            >
              {attaching ? 'Attaching…' : 'Attach invoice'}
            </Button>
          </>
        )}
      </Stack>

      <Collapse in={open} id={detailsId}>
        <Box sx={{ mt: 1.25, pt: 1.25, borderTop: '1px solid', borderColor: 'divider' }}>
          <Box
            component="table"
            sx={{
              width: '100%', borderCollapse: 'collapse',
              '& th, & td': { py: 0.5, px: 0, fontSize: '0.8125rem', verticalAlign: 'top' },
              '& th': { color: 'text.secondary', fontWeight: 500, textAlign: 'left' },
              '& .num': { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', pl: 1.5 },
              // A phone keeps what was bought and what it cost; the arithmetic
              // between them is the desk's.
              '& .wide': { display: { xs: 'none', sm: 'table-cell' } },
            }}
          >
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Qty</th>
                <th className="num wide">Each</th>
                <th className="num wide">Discount</th>
                <th className="num wide">Tax</th>
                <th className="num">Paid</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line, index) => (
                <tr key={index}>
                  <td>
                    <Typography variant="body2" sx={{ fontSize: 'inherit', overflowWrap: 'anywhere' }}>
                      {line.key ? colorLabel(line.key) : line.description.split(' — ')[0]}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem', overflowWrap: 'anywhere' }}>
                      {line.key
                        ? `${line.variant === 'refill' ? 'Refill' : 'With spool'} · ${formatExactGrams(line.gramsPerUnit)}`
                        : line.description.split(' — ').slice(1).join(' — ')}
                      {line.sku && <> · {line.sku}</>}
                    </Typography>
                  </td>
                  <td className="num">{line.quantity}</td>
                  <td className="num wide">{line.unitPrice === null ? '—' : money(line.unitPrice)}</td>
                  <td className="num wide">{line.discount ? `−${money(line.discount)}` : ''}</td>
                  <td className="num wide">{line.tax ? money(line.tax) : ''}</td>
                  <td className="num">{costs[index] === null ? '—' : money(costs[index]!)}</td>
                </tr>
              ))}
            </tbody>
          </Box>
          {priced && (
            <Stack spacing={0.25} sx={{ mt: 1.25, ml: 'auto', maxWidth: 320 }}>
              <MoneyRow label="Items, after their discounts" value={money(summary.itemsSubtotal)} />
              {summary.orderDiscount > 0 && <MoneyRow label="Order discount" value={`−${money(summary.orderDiscount)}`} />}
              {summary.credit > 0 && <MoneyRow label="Store credit" value={`−${money(summary.credit)}`} />}
              <MoneyRow label="Shipping" value={summary.shipping > 0 ? money(summary.shipping) : 'Free'} />
              {summary.tax > 0 && <MoneyRow label="Tax" value={money(summary.tax)} />}
              <MoneyRow label="Paid" value={money(summary.paid)} strong />
            </Stack>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem', mt: 1 }}>
            “Paid” per item includes its share of any order discount, store credit and shipping.
            {order.invoice && <> Kept file: {order.invoice.filename}.</>}
          </Typography>
        </Box>
      </Collapse>
    </Paper>
  )
}

export default function OrdersPage() {
  const [book, setBook] = useState<OrderBook | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [proposals, setProposals] = useState<InvoiceProposal[] | null>(null)
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()
  const addKey = params.get('add')
  const [manualOpen, setManualOpen] = useState(addKey !== null)
  const [manualError, setManualError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [attaching, setAttaching] = useState<string | null>(null)
  const confirm = useConfirm()

  const load = useCallback(() => {
    setLoadError(null)
    let cancelled = false
    void getOrders()
      .then(result => { if (!cancelled) setBook(result) })
      .catch(error => { if (!cancelled) setLoadError(messageOf(error)) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => load(), [load])

  const readInvoices = useCallback(async (files: FileList | null) => {
    if (!files?.length) return
    setReading(true)
    setNotice(null)
    const logged = new Set((book?.orders ?? []).map(order => order.orderNumber).filter(Boolean))
    const seen = new Set<string>()
    const next: InvoiceProposal[] = []
    for (const file of Array.from(files)) {
      try {
        const parsed = parseBambuInvoice(await pdfTextItems(file))
        const number = parsed.order.orderNumber ?? ''
        // The same invoice twice in one pick, or one already logged.
        const duplicate = logged.has(number) || seen.has(number)
        seen.add(number)
        next.push({ file: file.name, source: file, parsed, error: null, duplicate, include: true })
      } catch (error) {
        next.push({
          file: file.name,
          parsed: null,
          error: error instanceof InvoiceParseError ? error.message : 'This PDF could not be read.',
          duplicate: false,
          include: false,
        })
      }
    }
    // Oldest first, the order they will be used up in.
    next.sort((a, b) => (a.parsed?.order.orderedAt ?? '').localeCompare(b.parsed?.order.orderedAt ?? ''))
    setProposals(next)
    setReading(false)
    if (fileRef.current) fileRef.current.value = ''
  }, [book])

  const saveProposals = useCallback(async () => {
    if (!proposals) return
    setSaving(true)
    let saved = 0
    const failed: string[] = []
    const unkept: string[] = []
    for (const proposal of proposals) {
      if (!proposal.include || !saveable(proposal)) continue
      try {
        const order = await createOrder(toInput(proposal.parsed!.order))
        saved += 1
        // The order is the record; the PDF is kept beside it for reference,
        // and a failure to keep it never undoes the order.
        if (proposal.source) {
          await uploadInvoice(order.id, proposal.source, proposal.file)
            .catch(() => { unkept.push(proposal.parsed!.order.orderNumber ?? proposal.file) })
        }
      } catch (error) {
        failed.push(`${proposal.parsed!.order.orderNumber}: ${
          error instanceof ApiRequestError && error.status === 409 ? 'already logged' : messageOf(error)}`)
      }
    }
    setSaving(false)
    setProposals(null)
    setNotice(`${saved} ${saved === 1 ? 'order' : 'orders'} saved.${
      failed.length ? ` Not saved — ${failed.join('; ')}.` : ''}${
      unkept.length ? ` The invoice file was not kept for ${unkept.join(', ')}; attach it from the order.` : ''}`)
    load()
  }, [proposals, load])

  const saveManual = useCallback((order: FilamentOrderInput) => {
    setSaving(true)
    setManualError(null)
    void createOrder(order)
      .then(() => {
        setManualOpen(false)
        if (addKey) setParams({}, { replace: true })
        setNotice('Rolls added.')
        load()
      })
      .catch(error => setManualError(messageOf(error)))
      .finally(() => setSaving(false))
  }, [addKey, setParams, load])

  const remove = useCallback(async (order: FilamentOrder) => {
    const ok = await confirm({
      title: 'Delete this order?',
      message: 'Its rolls come off your shelf and out of your average prices. You can log it again.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteOrder(order.id)
      load()
    } catch (error) {
      setNotice(messageOf(error))
    }
  }, [confirm, load])

  const openInvoice = useCallback(async (order: FilamentOrder) => {
    // Opened before the fetch, so the browser treats it as the click's own
    // window rather than a pop-up.
    const win = window.open('', '_blank')
    try {
      const url = URL.createObjectURL(await fetchInvoice(order.id))
      if (win) win.location.href = url
      else window.location.assign(url)
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (error) {
      win?.close()
      setNotice(messageOf(error))
    }
  }, [])

  const attach = useCallback(async (order: FilamentOrder, file: File) => {
    setAttaching(order.id)
    try {
      await uploadInvoice(order.id, file, file.name)
      load()
    } catch (error) {
      setNotice(messageOf(error))
    } finally {
      setAttaching(null)
    }
  }, [load])

  const totals = useMemo(() => {
    const rolls = rollsOf(book?.orders ?? [])
    const priced = rolls.filter(roll => roll.cost !== null)
    const grams = priced.reduce((sum, roll) => sum + roll.grams, 0)
    const spent = priced.reduce((sum, roll) => sum + roll.cost!, 0)
    const currencies = new Set(priced.map(roll => roll.currency))
    const paid = (book?.orders ?? []).reduce((sum, order) =>
      sum + (order.lines.some(line => line.unitPrice !== null) ? orderSummary(order).paid : 0), 0)
    return {
      orders: book?.orders.length ?? 0,
      paid,
      rolls: rolls.length,
      grams: rolls.reduce((sum, roll) => sum + roll.grams, 0),
      spent,
      perKg: grams > 0 ? (spent / grams) * 1000 : null,
      currency: currencies.size === 1 ? [...currencies][0] : null,
    }
  }, [book])

  const newestFirst = useMemo(() => [...(book?.orders ?? [])].reverse(), [book])

  return (
    <Stack spacing={2} sx={{ p: { xs: 0, sm: 1, md: 2.5 }, maxWidth: 1120, width: '100%' }}>
      <Box>
        <Link
          component={RouterLink}
          to="/filaments"
          variant="body2"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}
        >
          <ArrowBackRoundedIcon sx={{ fontSize: 16 }} /> Filaments
        </Link>
        <Typography variant="h1" component="h1">Orders</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {book && totals.rolls > 0 ? (
            <>
              {totals.orders} {totals.orders === 1 ? 'order' : 'orders'}
              {totals.currency && <> · {formatMoney(totals.paid, totals.currency)} paid in all</>}
              {' '}· {rollsLabel(totals.rolls)} of filament ({formatExactGrams(totals.grams)})
              {totals.currency && totals.perKg !== null && (
                <> for {formatMoney(totals.spent, totals.currency)}, {formatMoney(totals.perKg, totals.currency)} / kg on average</>
              )}
            </>
          ) : 'Your purchase history. What you bought is what is on your shelf.'}
        </Typography>
      </Box>

      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          aria-label="Bambu Lab invoices"
          onChange={event => { void readInvoices(event.target.files) }}
        />
        <Button
          variant="contained"
          startIcon={<UploadFileRoundedIcon />}
          disabled={reading || !book}
          onClick={() => fileRef.current?.click()}
        >
          {reading ? 'Reading…' : 'Upload invoices'}
        </Button>
        <Button
          variant="outlined"
          startIcon={<AddRoundedIcon />}
          disabled={!book}
          onClick={() => { setManualError(null); setManualOpen(true) }}
        >
          Add without an invoice
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Bambu Lab US store invoices, as PDFs. Each is read on this device and checked by you;
        once saved, the PDF is kept with its order, private to your account, to open again.
      </Typography>

      {notice && (
        <Typography role="status" variant="body2" sx={{ fontWeight: 600 }}>{notice}</Typography>
      )}

      {loadError && <ErrorState message={loadError} onRetry={load} />}
      {!loadError && !book && <LoadingState label="Loading your orders…" />}
      {book && book.orders.length === 0 && (
        <EmptyState
          title="No orders yet"
          description="Upload your Bambu Lab invoices to fill your shelf and price your filament."
        />
      )}

      {newestFirst.map(order => (
        <OrderCard
          key={order.id}
          order={order}
          onDelete={() => { void remove(order) }}
          onOpenInvoice={() => { void openInvoice(order) }}
          onAttach={file => { void attach(order, file) }}
          attaching={attaching === order.id}
        />
      ))}

      <InvoiceReviewDialog
        proposals={proposals}
        busy={saving}
        onChange={setProposals}
        onClose={() => setProposals(null)}
        onSave={() => { void saveProposals() }}
      />
      <ManualOrderDialog
        open={manualOpen}
        initialKey={addKey}
        busy={saving}
        error={manualError}
        onClose={() => {
          setManualOpen(false)
          if (addKey) setParams({}, { replace: true })
        }}
        onSave={saveManual}
      />
    </Stack>
  )
}
