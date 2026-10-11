// What was bought, and what that says about the shelf.
//
// Orders are the inventory. A person logs what they ordered and what they
// paid; how many rolls are on hand, how many grams are left and what a
// kilogram of each colour costs are all *derived* -- from the orders, the
// grams the printer has used, and the rolls a person has marked empty.
//
// Spool or refill matters only for money: a refill is the same kilogram on no
// reel, sold for less. So a colour's rolls are counted together, and its price
// is the average of what each roll actually cost.
//
// "Actually cost" is landed cost: the line's price after its own discount,
// with its share of any order-level discount, store credit and shipping, plus
// its own tax. The landed costs of an order add back up to what was paid.
//
// Pure, and shared: the server derives the owned list from it, and the page
// shows the same numbers.
import { FILAMENT_LINES, filamentByKey } from './bambuFilaments.ts'
import type { FilamentVariant } from './bambuFilaments.ts'

/** Where an order came from. A manual one has no invoice behind it. */
export type FilamentOrderSource = 'bambu-us-invoice' | 'manual'

export interface FilamentOrderLine {
  /** Catalogue key, or null for a line that is not filament (a hotend, a plate). */
  key: string | null
  /** What the invoice called it, kept so a line can be checked against its source. */
  description: string
  sku: string | null
  /** Null exactly when `key` is null. */
  variant: FilamentVariant | null
  /** Filament per unit; 0 for a line that is not filament. */
  gramsPerUnit: number
  quantity: number
  /** Before tax, per unit, before any discount. Null when unknown (a gift). */
  unitPrice: number | null
  /** The line's own discount, for the whole quantity. */
  discount: number
  /** The line's tax, for the whole quantity. */
  tax: number
}

export interface FilamentOrderInput {
  source: FilamentOrderSource
  /** The store's order number; unique per account. Null for a manual entry. */
  orderNumber: string | null
  /** `YYYY-MM-DD`. */
  orderedAt: string
  currency: string
  /** Order-level adjustments, as positive amounts. */
  orderDiscount: number
  credit: number
  shipping: number
  /** What was paid in the end, when the source says. Checked against the lines. */
  grandTotal: number | null
  note: string | null
  lines: FilamentOrderLine[]
}

/** The original invoice kept with an order, for reference. */
export interface FilamentOrderInvoice {
  filename: string
  contentType: 'application/pdf' | 'image/png' | 'image/jpeg'
  byteLength: number
}

export interface FilamentOrder extends FilamentOrderInput {
  id: string
  createdAt: string
  /** Null when no file was kept with this order. */
  invoice: FilamentOrderInvoice | null
}

/** A colour's rolls a person has marked used up, beyond what usage alone says. */
export interface FilamentRollAdjustment {
  key: string
  /** Rolls of this colour marked empty, counted from the oldest. */
  finished: number
}

const cents = (amount: number): number => Math.round(amount * 100) / 100

/** Before tax and before order-level adjustments, after the line's own discount. */
export const lineNet = (line: FilamentOrderLine): number =>
  line.unitPrice === null ? 0 : line.unitPrice * line.quantity - line.discount

/**
 * What each line of an order cost in the end, for its whole quantity, in
 * order. Order-level discount, credit and shipping are shared out in
 * proportion to each line's net; tax is the line's own.
 *
 * A line with no price (a gift, a roll bought in a shop with no receipt kept)
 * costs null rather than zero: an average that counted it as free would read
 * as a cheaper colour rather than as an unpriced one.
 */
export function landedCosts(order: FilamentOrderInput): (number | null)[] {
  const nets = order.lines.map(lineNet)
  const total = nets.reduce((sum, net) => sum + net, 0)
  const adjustment = order.shipping - order.orderDiscount - order.credit
  return order.lines.map((line, index) => {
    if (line.unitPrice === null) return null
    const share = total > 0 ? (nets[index] / total) * adjustment : 0
    return nets[index] + share + line.tax
  })
}

/** The money of an order the way its invoice states it. */
export interface OrderSummary {
  /** After each line's own discount, before tax and order-level adjustments. */
  itemsSubtotal: number
  /** Every line's own discount, added up. */
  lineDiscounts: number
  orderDiscount: number
  credit: number
  shipping: number
  tax: number
  /** What was paid: the invoice's grand total, or the lines' sum when it has none. */
  paid: number
  /** Landed cost of the filament lines alone. */
  filament: number
}

export function orderSummary(order: FilamentOrderInput): OrderSummary {
  const costs = landedCosts(order)
  return {
    itemsSubtotal: cents(order.lines.reduce((sum, line) => sum + lineNet(line), 0)),
    lineDiscounts: cents(order.lines.reduce((sum, line) => sum + line.discount, 0)),
    orderDiscount: order.orderDiscount,
    credit: order.credit,
    shipping: order.shipping,
    tax: cents(order.lines.reduce((sum, line) => sum + line.tax, 0)),
    paid: order.grandTotal ?? orderTotal(order),
    filament: cents(order.lines.reduce((sum, line, index) =>
      sum + (line.key && costs[index] !== null ? costs[index]! : 0), 0)),
  }
}

/** Lines plus adjustments, the way the invoice's grand total is reached. */
export const orderTotal = (order: FilamentOrderInput): number => cents(
  order.lines.reduce((sum, line) => sum + lineNet(line) + line.tax, 0)
  + order.shipping - order.orderDiscount - order.credit)

/** True when the lines add up to what the source said was paid, to the cent. */
export const totalsAgree = (order: FilamentOrderInput): boolean =>
  order.grandTotal === null || Math.abs(orderTotal(order) - order.grandTotal) < 0.015

/** One roll of filament, as bought. */
export interface Roll {
  key: string
  variant: FilamentVariant
  grams: number
  /** Landed cost of this one roll, or null when unpriced. */
  cost: number | null
  currency: string
  orderedAt: string
  orderId: string
}

/** Every roll in every order, oldest first -- the order they are used up in. */
export function rollsOf(orders: readonly FilamentOrder[]): Roll[] {
  const rolls: Roll[] = []
  for (const order of orders) {
    const costs = landedCosts(order)
    order.lines.forEach((line, index) => {
      if (!line.key || !line.variant || line.gramsPerUnit <= 0) return
      const each = costs[index] === null ? null : costs[index]! / line.quantity
      for (let n = 0; n < line.quantity; n++) {
        rolls.push({
          key: line.key, variant: line.variant, grams: line.gramsPerUnit, cost: each,
          currency: order.currency, orderedAt: order.orderedAt, orderId: order.id,
        })
      }
    })
  }
  // Stable: rolls bought the same day keep their invoice order.
  return rolls
    .map((roll, index) => ({ roll, index }))
    .sort((a, b) => a.roll.orderedAt.localeCompare(b.roll.orderedAt) || a.index - b.index)
    .map(entry => entry.roll)
}

/** One colour's shelf, as the orders, the printer and the person describe it. */
export interface ColorLedger {
  key: string
  /** Every roll ever bought, oldest first. */
  rolls: Roll[]
  purchasedGrams: number
  usedGrams: number
  /** Rolls used up: by usage, or marked so by hand, whichever is more. */
  finished: number
  /** Of `finished`, how many only the person's mark accounts for. */
  finishedByHand: number
  /** Rolls not yet used up, spools and refills together. */
  rollsOnHand: number
  /** Rolls on hand by form, for the owned list's wire shape. */
  onHandByVariant: Record<FilamentVariant, number>
  /** Grams bought, less grams used -- or less every finished roll, when that is more. */
  gramsAvailable: number
  /**
   * Grams printed beyond everything bought: usage with no order behind it.
   * Worth saying, because it means an order is missing.
   */
  gramsUnaccounted: number
  /** Weighted average landed cost of a kilogram, over priced rolls; null if none is. */
  costPerKg: number | null
  currency: string | null
  /** What the priced rolls cost altogether. */
  spent: number
}

const variantsZero = (): Record<FilamentVariant, number> => ({ spool: 0, refill: 0 })

/**
 * The ledger for every colour that has been bought or used.
 *
 * Rolls are used up oldest first. A roll counts as finished once usage has
 * passed its last gram; a person can mark more finished than that (the slicer
 * estimates grams, and a reel can run out early), never fewer -- grams printed
 * are grams gone.
 */
export function ledgerOf(
  orders: readonly FilamentOrder[],
  usedGrams: ReadonlyMap<string, number>,
  adjustments: readonly FilamentRollAdjustment[] = [],
): Map<string, ColorLedger> {
  const byKey = new Map<string, Roll[]>()
  for (const roll of rollsOf(orders)) byKey.set(roll.key, [...(byKey.get(roll.key) ?? []), roll])
  const marked = new Map(adjustments.map(entry => [entry.key, entry.finished]))
  const keys = new Set([...byKey.keys(), ...usedGrams.keys()])

  const ledgers = new Map<string, ColorLedger>()
  for (const key of keys) {
    const rolls = byKey.get(key) ?? []
    const used = Math.max(0, usedGrams.get(key) ?? 0)
    const purchasedGrams = rolls.reduce((sum, roll) => sum + roll.grams, 0)

    let byUsage = 0
    let cumulative = 0
    for (const roll of rolls) {
      cumulative += roll.grams
      if (cumulative <= used) byUsage += 1
      else break
    }
    const finished = Math.min(rolls.length, Math.max(byUsage, marked.get(key) ?? 0))
    const finishedGrams = rolls.slice(0, finished).reduce((sum, roll) => sum + roll.grams, 0)
    const onHandByVariant = variantsZero()
    for (const roll of rolls.slice(finished)) onHandByVariant[roll.variant] += 1

    const priced = rolls.filter(roll => roll.cost !== null)
    const pricedGrams = priced.reduce((sum, roll) => sum + roll.grams, 0)
    const spent = priced.reduce((sum, roll) => sum + roll.cost!, 0)
    const currencies = new Set(priced.map(roll => roll.currency))

    ledgers.set(key, {
      key,
      rolls,
      purchasedGrams,
      usedGrams: used,
      finished,
      finishedByHand: finished - byUsage,
      rollsOnHand: rolls.length - finished,
      onHandByVariant,
      gramsAvailable: Math.max(0, purchasedGrams - Math.max(used, finishedGrams)),
      gramsUnaccounted: Math.max(0, used - purchasedGrams),
      // A mixed-currency colour has no honest average.
      costPerKg: pricedGrams > 0 && currencies.size === 1 ? (spent / pricedGrams) * 1000 : null,
      currency: currencies.size === 1 ? [...currencies][0] : null,
      spent: cents(spent),
    })
  }
  return ledgers
}

/** The owned list's wire shape: one entry per colour and form with rolls on hand. */
export function ownedOf(ledgers: ReadonlyMap<string, ColorLedger>): {
  key: string; variant: FilamentVariant; quantity: number
}[] {
  const owned: { key: string; variant: FilamentVariant; quantity: number }[] = []
  for (const ledger of ledgers.values()) {
    for (const variant of ['spool', 'refill'] as const) {
      const quantity = ledger.onHandByVariant[variant]
      if (quantity > 0) owned.push({ key: ledger.key, variant, quantity })
    }
  }
  return owned.sort((a, b) => a.key.localeCompare(b.key) || a.variant.localeCompare(b.variant))
}

/** True when `key` is a catalogue colour sold in `variant`. */
export function sellsVariant(key: string, variant: FilamentVariant): boolean {
  const color = filamentByKey(key)
  if (!color) return false
  const line = FILAMENT_LINES.find(entry => `${entry.brand}/${entry.material}/${entry.type}` === color.line)
  return line?.variants.includes(variant) ?? false
}

/** What a kilogram costs, in the currency it was paid in. */
export interface KilogramPrice {
  pricePerKg: number
  currency: string
}

const lineOfKey = (key: string): string => key.split('/').slice(0, 3).join('/')

/**
 * Price lookup from orders. A colour bought is priced at the weighted average
 * landed cost of its rolls; a colour never bought, at the average of every
 * roll bought in its line -- a fair stand-in, since a line is priced as one --
 * and otherwise not at all. Mixed currencies give no price rather than a sum.
 */
export function priceBookOf(orders: readonly FilamentOrder[]): (key: string) => KilogramPrice | null {
  const add = (map: Map<string, { cost: number; grams: number; currencies: Set<string> }>, id: string, roll: Roll) => {
    const entry = map.get(id) ?? { cost: 0, grams: 0, currencies: new Set<string>() }
    entry.cost += roll.cost!
    entry.grams += roll.grams
    entry.currencies.add(roll.currency)
    map.set(id, entry)
  }
  const byKey = new Map<string, { cost: number; grams: number; currencies: Set<string> }>()
  const byLine = new Map<string, { cost: number; grams: number; currencies: Set<string> }>()
  for (const roll of rollsOf(orders)) {
    if (roll.cost === null || roll.grams <= 0) continue
    add(byKey, roll.key, roll)
    add(byLine, lineOfKey(roll.key), roll)
  }
  const priceFrom = (entry?: { cost: number; grams: number; currencies: Set<string> }): KilogramPrice | null =>
    entry && entry.grams > 0 && entry.currencies.size === 1
      ? { pricePerKg: (entry.cost / entry.grams) * 1000, currency: [...entry.currencies][0] }
      : null
  return key => priceFrom(byKey.get(key)) ?? priceFrom(byLine.get(lineOfKey(key)))
}
