// Reading a Bambu Lab US store invoice into an order.
//
// The invoice is a PDF with a real text layer, so this reads positioned text
// rather than guessing at line order: every row of the items table has its
// description in the first column and its numbers in fixed columns to the
// right, at the height of the description's middle. The columns are found from
// the table's own header on each page, so a page that is laid out a little
// differently still reads.
//
// It proposes; it never saves. A line it cannot match to the catalogue comes
// back unmatched for a person to settle, and the order carries a check that
// its lines add up to what the invoice says was paid -- which catches anything
// misread before it can become a wrong price.
//
// Pure, and shared: the page parses what pdf.js extracted in the browser, and
// the dry-run script parses the same thing in Node.
import { FILAMENT_CATALOG, FILAMENT_LINES } from './bambuFilaments.ts'
import type { FilamentVariant } from './bambuFilaments.ts'
import { totalsAgree } from './filamentOrders.ts'
import type { FilamentOrderInput, FilamentOrderLine } from './filamentOrders.ts'

/** One run of text, positioned as pdf.js reports it: y grows up the page. */
export interface PdfTextItem {
  str: string
  x: number
  y: number
  width: number
  page: number
}

export interface ParsedInvoiceLine extends FilamentOrderLine {
  /**
   * True for a line that looks like filament but did not match a catalogue
   * colour: the person picks it, rather than this guessing.
   */
  unmatched: boolean
}

export interface ParsedInvoice {
  order: Omit<FilamentOrderInput, 'lines'> & { lines: ParsedInvoiceLine[] }
  /** Things a person should look at before saving. Empty when it all read cleanly. */
  warnings: string[]
}

export class InvoiceParseError extends Error {}

const MONEY = /^-?\$([\d,]+\.\d{2})$/
const money = (text: string): number | null => {
  const match = MONEY.exec(text.trim())
  return match ? Number(match[1].replace(/,/g, '')) : null
}

const centre = (item: PdfTextItem): number => item.x + item.width / 2

const LINE_BY_LABEL = new Map(FILAMENT_LINES.map(line => [
  line.label.toLowerCase(), `${line.brand}/${line.material}/${line.type}`,
]))

/** The labels the totals block uses, and the order field each one fills. */
const TOTALS: Record<string, 'itemsSubtotal' | 'orderDiscount' | 'credit' | 'shipping' | 'grandTotal' | null> = {
  'items subtotal': 'itemsSubtotal',
  'order discount': 'orderDiscount',
  'use credit': 'credit',
  shipping: 'shipping',
  'grand total': 'grandTotal',
  // Read, and checked by the arithmetic rather than used.
  'total exclude tax': null,
  tax: null,
  'net payment': null,
}

interface Columns {
  headerY: number
  qty: number
  price: number
  discount: number
  taxAmount: number
  subtotal: number
  /** Descriptions sit left of this. */
  descriptionLimit: number
}

function columnsOf(items: readonly PdfTextItem[]): Columns | null {
  const find = (text: string) => items.find(item => item.str.trim() === text)
  const qty = find('Qty')
  const price = find('Price(excl.tax)')
  const discount = find('discount')
  const amount = find('amount')
  const subtotal = find('SubTotal')
  if (!qty || !price || !discount || !amount || !subtotal) return null
  return {
    headerY: Math.min(qty.y, discount.y, amount.y, subtotal.y),
    qty: centre(qty),
    price: centre(price),
    discount: centre(discount),
    taxAmount: centre(amount),
    subtotal: centre(subtotal),
    descriptionLimit: qty.x - 10,
  }
}

interface Block {
  page: number
  /** Top of the name line, bottom of the last line. */
  top: number
  bottom: number
  lines: string[]
}

/**
 * The item descriptions on one page, one block per item. An item is a name
 * line followed by a `SKU:` line; its block runs on while each next line sits
 * one text line below the last.
 */
function blocksOf(items: readonly PdfTextItem[], columns: Columns): Block[] {
  const column = items
    .filter(item => item.x < columns.descriptionLimit && item.y < columns.headerY - 4)
    .sort((a, b) => b.y - a.y || a.x - b.x)
  const blocks: Block[] = []
  let current: Block | null = null
  let lastY = Infinity
  for (let index = 0; index < column.length; index++) {
    const item = column[index]
    const text = item.str.trim()
    const next = column[index + 1]
    const startsItem = next && next.str.trim().startsWith('SKU:') && lastY - item.y > 4
    if (startsItem && !text.startsWith('SKU:') && !text.startsWith('Variant:')) {
      current = { page: item.page, top: item.y, bottom: item.y, lines: [text] }
      blocks.push(current)
    } else if (current && lastY - item.y < 20) {
      current.lines.push(text)
      current.bottom = item.y
    } else {
      current = null
    }
    lastY = item.y
  }
  return blocks
}

interface NumberRow {
  y: number
  quantity: number
  price: number | null
  discount: number
  tax: number
  subtotal: number | null
}

/** Every row of numbers on a page, anchored on the integer in the Qty column. */
function rowsOf(items: readonly PdfTextItem[], columns: Columns): NumberRow[] {
  const rows: NumberRow[] = []
  for (const anchor of items) {
    if (!/^\d+$/.test(anchor.str.trim())) continue
    if (Math.abs(centre(anchor) - columns.qty) > 14 || anchor.y >= columns.headerY - 4) continue
    const row: NumberRow = {
      y: anchor.y, quantity: Number(anchor.str.trim()), price: null, discount: 0, tax: 0, subtotal: null,
    }
    for (const item of items) {
      if (Math.abs(item.y - anchor.y) > 2.5) continue
      const value = money(item.str)
      if (value === null) continue
      const x = centre(item)
      const nearest = (['price', 'discount', 'taxAmount', 'subtotal'] as const)
        .map(column => ({ column, distance: Math.abs(columns[column] - x) }))
        .sort((a, b) => a.distance - b.distance)[0]
      if (nearest.distance > 40) continue
      if (nearest.column === 'price') row.price = value
      else if (nearest.column === 'discount') row.discount = value
      else if (nearest.column === 'taxAmount') row.tax = value
      else row.subtotal = value
    }
    rows.push(row)
  }
  return rows
}

const joinSku = (parts: string[]): string => parts.join('').replace(/^SKU:\s*/, '').replace(/\s+/g, '')

/** "Jade White (10100) / Refill / 1kg" and its wrapped forms. */
function describe(variantText: string): {
  code: string | null; colour: string | null; variant: FilamentVariant | null; grams: number | null
} {
  const code = /\((\d{5})\)/.exec(variantText)?.[1] ?? null
  const colour = /^\s*([^(/]+?)\s*\(\d{5}\)/.exec(variantText)?.[1] ?? null
  const variant: FilamentVariant | null = /\brefill\b/i.test(variantText) ? 'refill'
    : /with\s+spool/i.test(variantText) ? 'spool' : null
  const weight = /\/\s*([\d.]+)\s*(kg|g)\s*$/i.exec(variantText)
  const grams = weight ? Math.round(Number(weight[1]) * (weight[2].toLowerCase() === 'kg' ? 1000 : 1)) : null
  return { code, colour, variant, grams }
}

function lineOf(block: Block, row: NumberRow | undefined, warnings: string[]): ParsedInvoiceLine {
  const name = block.lines[0]
  const skuStart = block.lines.findIndex(line => line.startsWith('SKU:'))
  const variantStart = block.lines.findIndex(line => line.startsWith('Variant:'))
  const sku = skuStart >= 0
    ? joinSku(block.lines.slice(skuStart, variantStart >= 0 ? variantStart : undefined))
    : null
  const variantText = variantStart >= 0
    ? block.lines.slice(variantStart).join(' ').replace(/^Variant:\s*/, '').replace(/\s+/g, ' ').trim()
    : ''
  const description = [name, variantText].filter(Boolean).join(' — ')

  if (!row) warnings.push(`Could not read the quantity and price of “${description}”.`)
  const quantity = row?.quantity ?? 1
  const price = row?.price ?? null

  const lineId = LINE_BY_LABEL.get(name.toLowerCase())
  const { code, colour, variant, grams } = describe(variantText)
  const looksLikeFilament = Boolean(lineId) || variant !== null

  if (!looksLikeFilament) {
    return {
      key: null, description, sku, variant: null, gramsPerUnit: 0, quantity,
      unitPrice: price, discount: row?.discount ?? 0, tax: row?.tax ?? 0, unmatched: false,
    }
  }

  const match = lineId && code
    ? FILAMENT_CATALOG.find(color => color.line === lineId && color.code === code)
    : undefined
  if (!match) {
    warnings.push(`“${description}” looks like filament but matches no catalogue colour${
      colour ? ` (${name} ${colour}${code ? ` ${code}` : ''})` : ''}. Pick it before saving.`)
  }
  if (!variant) warnings.push(`“${description}” does not say whether it is a spool or a refill.`)
  if (!grams) warnings.push(`“${description}” does not say how much filament it is; 1 kg assumed.`)
  return {
    key: match?.key ?? null,
    description,
    sku,
    variant: variant ?? 'spool',
    gramsPerUnit: grams ?? 1000,
    quantity,
    unitPrice: price,
    discount: row?.discount ?? 0,
    tax: row?.tax ?? 0,
    unmatched: !match,
  }
}

/** The value printed to the right of a label, on the same baseline. */
function valueBeside(items: readonly PdfTextItem[], label: PdfTextItem): string | null {
  const beside = items
    .filter(item => item.page === label.page && Math.abs(item.y - label.y) < 2.5 && item.x > label.x + label.width - 1)
    .sort((a, b) => a.x - b.x)
  const inline = label.str.split(':').slice(1).join(':').trim()
  return inline || beside[0]?.str.trim() || null
}

export function parseBambuInvoice(items: readonly PdfTextItem[]): ParsedInvoice {
  const warnings: string[] = []
  const all = items.filter(item => item.str.trim())
  const text = all.map(item => item.str).join(' ')
  if (!/us\.store\.bambulab\.com|Bambu Lab US/i.test(text)) {
    throw new InvoiceParseError('This does not look like a Bambu Lab US store invoice.')
  }

  const labelled = (prefix: string) => {
    const label = all.find(item => item.str.trim().startsWith(prefix))
    return label ? valueBeside(all, label) : null
  }
  const orderNumber = labelled('Order Number:')
  const orderedAt = labelled('Invoice Date:') ?? labelled('Payment Date:')
  if (!orderNumber) throw new InvoiceParseError('The invoice has no order number.')
  if (!orderedAt || !/^\d{4}-\d{2}-\d{2}$/.test(orderedAt)) {
    throw new InvoiceParseError('The invoice has no readable date.')
  }

  const lines: ParsedInvoiceLine[] = []
  const pages = [...new Set(all.map(item => item.page))].sort((a, b) => a - b)
  for (const page of pages) {
    const onPage = all.filter(item => item.page === page)
    const columns = columnsOf(onPage)
    if (!columns) continue
    const blocks = blocksOf(onPage, columns)
    const rows = rowsOf(onPage, columns)
    for (const block of blocks) {
      // The numbers sit level with the middle of the description; take the
      // row inside the block, or failing that the nearest one.
      const inside = rows.filter(row => row.y <= block.top + 6 && row.y >= block.bottom - 6)
      const row = inside[0] ?? undefined
      lines.push(lineOf(block, row, warnings))
    }
  }
  if (!lines.length) throw new InvoiceParseError('No items were found on the invoice.')

  const totals: Partial<Record<'itemsSubtotal' | 'orderDiscount' | 'credit' | 'shipping' | 'grandTotal', number>> = {}
  const subtotalLabel = all.find(item => item.str.trim().toLowerCase() === 'items subtotal')
  if (subtotalLabel) {
    // Every label in the totals column, so an adjustment this does not know
    // (a coupon, points) is said out loud rather than silently dropped.
    const column = all.filter(item =>
      item.page === subtotalLabel.page && Math.abs(item.x - subtotalLabel.x) < 3 && item.y <= subtotalLabel.y)
    for (const label of column) {
      const name = label.str.trim().toLowerCase()
      if (!(name in TOTALS)) {
        warnings.push(`The invoice lists “${label.str.trim()}”, which this does not account for.`)
        continue
      }
      const field = TOTALS[name]
      const value = valueBeside(all, label)
      if (field && value !== null) {
        const amount = money(value)
        if (amount !== null) totals[field] = amount
      }
    }
  }

  const order: ParsedInvoice['order'] = {
    source: 'bambu-us-invoice',
    orderNumber,
    orderedAt,
    currency: 'USD',
    orderDiscount: totals.orderDiscount ?? 0,
    credit: totals.credit ?? 0,
    shipping: totals.shipping ?? 0,
    grandTotal: totals.grandTotal ?? null,
    note: null,
    lines,
  }
  if (order.grandTotal === null) warnings.push('The invoice has no readable grand total, so nothing checks the prices.')
  else if (!totalsAgree(order)) {
    warnings.push(`The lines do not add up to the grand total of $${order.grandTotal.toFixed(2)}; check the prices.`)
  }
  if (!lines.some(line => line.key || line.unmatched)) warnings.push('There is no filament on this invoice.')
  return { order, warnings }
}
