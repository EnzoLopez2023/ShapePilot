// Runtime validation for the filament order routes.
//
// The catalogue is committed code the server can see, so a filament line names
// a real colour sold in the form it claims, or it is refused here. A line that
// is not filament (a hotend on the same invoice) has no key and no variant, and
// is kept because it takes its share of the order's credit and shipping.
import { ApiError } from '../errors/ApiError.ts'
import { filamentByKey } from '../../lib/contracts/bambuFilaments.ts'
import { sellsVariant } from '../../lib/contracts/filamentOrders.ts'
import type {
  FilamentOrderInput, FilamentOrderLine, FilamentRollAdjustment,
} from '../../lib/contracts/filamentOrders.ts'

export const LIMITS = {
  maxLines: 200,
  maxQuantity: 999,
  maxGrams: 10_000,
  maxMoney: 100_000,
  maxText: 300,
  maxNote: 500,
} as const

const ORDER_KEYS = [
  'source', 'orderNumber', 'orderedAt', 'currency', 'orderDiscount', 'credit', 'shipping',
  'grandTotal', 'note', 'lines',
] as const
const LINE_KEYS = [
  'key', 'description', 'sku', 'variant', 'gramsPerUnit', 'quantity', 'unitPrice', 'discount', 'tax',
] as const

const bad = (field: string, message: string): never => {
  throw new ApiError(400, 'bad_request', message, { field })
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const onlyKeys = (value: Record<string, unknown>, keys: readonly string[], field: string) => {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) bad(`${field}.${key}`, `${field} does not accept the field "${key}"`)
  }
}

/** Money to the cent, never negative. `nullable` allows null for "not known". */
function amount(value: unknown, field: string, nullable: true): number | null
function amount(value: unknown, field: string, nullable?: false): number
function amount(value: unknown, field: string, nullable = false): number | null {
  if (value === undefined) return nullable ? null : 0
  if (value === null && nullable) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > LIMITS.maxMoney) {
    return bad(field, `${field} must be an amount from 0 to ${LIMITS.maxMoney}`)
  }
  return Math.round(value * 100) / 100
}

const integer = (value: unknown, field: string, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return bad(field, `${field} must be a whole number from ${min} to ${max}`)
  }
  return value
}

const text = (value: unknown, field: string, max: number, nullable: boolean): string | null => {
  if ((value === null || value === undefined) && nullable) return null
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    return bad(field, `${field} must be text of 1 to ${max} characters`)
  }
  return value.trim()
}

function line(raw: unknown, index: number): FilamentOrderLine {
  const field = `lines[${index}]`
  if (!isPlainObject(raw)) return bad(field, `${field} must be a JSON object`)
  onlyKeys(raw, LINE_KEYS, field)

  const key = raw.key ?? null
  const variant = raw.variant ?? null
  if (key !== null) {
    if (typeof key !== 'string' || !filamentByKey(key)) {
      bad(`${field}.key`, `${field}.key "${String(key)}" is not a colour in the catalogue`)
    }
    if (variant !== 'spool' && variant !== 'refill') {
      bad(`${field}.variant`, `${field}.variant must be "spool" or "refill"`)
    }
    if (!sellsVariant(key as string, variant as 'spool' | 'refill')) {
      bad(`${field}.variant`, `${String(key)} is not sold as a ${String(variant)}`)
    }
  } else if (variant !== null) {
    bad(`${field}.variant`, `${field}.variant must be null on a line that is not filament`)
  }

  const gramsPerUnit = key === null
    ? integer(raw.gramsPerUnit ?? 0, `${field}.gramsPerUnit`, 0, 0)
    : integer(raw.gramsPerUnit, `${field}.gramsPerUnit`, 1, LIMITS.maxGrams)

  return {
    key: key as string | null,
    description: text(raw.description, `${field}.description`, LIMITS.maxText, false)!,
    sku: text(raw.sku, `${field}.sku`, 120, true),
    variant: variant as FilamentOrderLine['variant'],
    gramsPerUnit,
    quantity: integer(raw.quantity, `${field}.quantity`, 1, LIMITS.maxQuantity),
    unitPrice: amount(raw.unitPrice, `${field}.unitPrice`, true),
    discount: amount(raw.discount, `${field}.discount`),
    tax: amount(raw.tax, `${field}.tax`),
  }
}

export function validateFilamentOrderInput(body: unknown): FilamentOrderInput {
  const root = isPlainObject(body) ? body : bad('body', 'body must be a JSON object')
  onlyKeys(root, ORDER_KEYS, 'body')

  const source = root.source
  if (source !== 'bambu-us-invoice' && source !== 'manual') {
    bad('source', 'source must be "bambu-us-invoice" or "manual"')
  }
  const orderNumber = text(root.orderNumber, 'orderNumber', 80, source === 'manual')
  if (source !== 'manual' && !orderNumber) bad('orderNumber', 'an invoice must carry its order number')

  const orderedAt = root.orderedAt
  if (typeof orderedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(orderedAt)
    || Number.isNaN(Date.parse(`${orderedAt}T00:00:00Z`))) {
    bad('orderedAt', 'orderedAt must be a date, YYYY-MM-DD')
  }
  const currency = root.currency
  if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency)) {
    bad('currency', 'currency must be a three-letter ISO 4217 code')
  }

  const lines = root.lines
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > LIMITS.maxLines) {
    bad('lines', `lines must be an array of 1 to ${LIMITS.maxLines} lines`)
  }
  const parsed = (lines as unknown[]).map(line)
  if (!parsed.some(entry => entry.key !== null)) bad('lines', 'an order must contain some filament')

  return {
    source: source as FilamentOrderInput['source'],
    orderNumber,
    orderedAt: orderedAt as string,
    currency: (currency as string).toUpperCase(),
    orderDiscount: amount(root.orderDiscount, 'orderDiscount'),
    credit: amount(root.credit, 'credit'),
    shipping: amount(root.shipping, 'shipping'),
    grandTotal: amount(root.grandTotal, 'grandTotal', true),
    note: text(root.note, 'note', LIMITS.maxNote, true),
    lines: parsed,
  }
}

export function validateRollAdjustmentInput(body: unknown): FilamentRollAdjustment {
  const root = isPlainObject(body) ? body : bad('body', 'body must be a JSON object')
  onlyKeys(root, ['key', 'finished'], 'body')
  if (typeof root.key !== 'string' || !filamentByKey(root.key)) {
    bad('key', `key "${String(root.key)}" is not a colour in the catalogue`)
  }
  return {
    key: root.key as string,
    finished: integer(root.finished, 'finished', 0, LIMITS.maxQuantity),
  }
}
