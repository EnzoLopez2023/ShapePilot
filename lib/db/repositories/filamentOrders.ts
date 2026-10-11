// Filament order repository.
//
// An order and its lines are written in one transaction and read back as one
// object; there is no editing an order in place -- a wrong one is deleted and
// logged again, which is what a person correcting a receipt does anyway.
import { randomUUID } from 'node:crypto'
import type { SqliteDatabase } from '../connection.ts'
import type { FilamentOrderRepository, Owner } from './contracts.ts'
import type {
  FilamentOrder, FilamentOrderInvoice, FilamentOrderLine, FilamentOrderSource,
  FilamentRollAdjustment,
} from '../../contracts/filamentOrders.ts'
import type { FilamentVariant } from '../../contracts/bambuFilaments.ts'

interface OrderRow {
  id: string
  source: FilamentOrderSource
  order_number: string | null
  ordered_at: string
  currency: string
  order_discount: number
  credit: number
  shipping: number
  grand_total: number | null
  note: string | null
  invoice_name: string | null
  invoice_type: FilamentOrderInvoice['contentType'] | null
  invoice_bytes: number | null
  created_at: string
}

interface LineRow {
  order_id: string
  filament_key: string | null
  variant: FilamentVariant | null
  description: string
  sku: string | null
  grams_per_unit: number
  quantity: number
  unit_price: number | null
  discount: number
  tax: number
}

const rowToLine = (row: LineRow): FilamentOrderLine => ({
  key: row.filament_key,
  description: row.description,
  sku: row.sku,
  variant: row.variant,
  gramsPerUnit: row.grams_per_unit,
  quantity: row.quantity,
  unitPrice: row.unit_price,
  discount: row.discount,
  tax: row.tax,
})

export function createFilamentOrderRepository(db: SqliteDatabase): FilamentOrderRepository {
  const selectOrders = db.prepare<[string, string], OrderRow>(`
    SELECT id, source, order_number, ordered_at, currency, order_discount, credit, shipping,
           grand_total, note, invoice_name, invoice_type, invoice_bytes, created_at
      FROM filament_orders
     WHERE owner_tenant_id = ? AND owner_oid = ?
     ORDER BY ordered_at, created_at, id`)

  const selectLines = db.prepare<[string, string], LineRow>(`
    SELECT l.order_id, l.filament_key, l.variant, l.description, l.sku, l.grams_per_unit,
           l.quantity, l.unit_price, l.discount, l.tax
      FROM filament_order_lines l
      JOIN filament_orders o ON o.id = l.order_id
     WHERE o.owner_tenant_id = ? AND o.owner_oid = ?
     ORDER BY l.order_id, l.position`)

  const findByNumber = db.prepare<[string, string, string], { id: string }>(`
    SELECT id FROM filament_orders
     WHERE owner_tenant_id = ? AND owner_oid = ? AND order_number = ?`)

  const insertOrder = db.prepare(`
    INSERT INTO filament_orders (id, owner_tenant_id, owner_oid, source, order_number, ordered_at,
      currency, order_discount, credit, shipping, grand_total, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

  const insertLine = db.prepare(`
    INSERT INTO filament_order_lines (order_id, position, filament_key, variant, description, sku,
      grams_per_unit, quantity, unit_price, discount, tax)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

  const setInvoice = db.prepare(`
    UPDATE filament_orders
       SET invoice_hash = ?, invoice_name = ?, invoice_type = ?, invoice_bytes = ?
     WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?`)

  const selectInvoice = db.prepare<[string, string, string], {
    invoice_hash: string | null; invoice_name: string | null; invoice_type: FilamentOrderInvoice['contentType'] | null
  }>(`
    SELECT invoice_hash, invoice_name, invoice_type FROM filament_orders
     WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?`)

  const deleteOrder = db.prepare(
    'DELETE FROM filament_orders WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?')

  const selectAdjustments = db.prepare<[string, string], { filament_key: string; finished: number }>(`
    SELECT filament_key, finished FROM filament_roll_adjustments
     WHERE owner_tenant_id = ? AND owner_oid = ?
     ORDER BY filament_key`)

  const upsertAdjustment = db.prepare(`
    INSERT INTO filament_roll_adjustments (owner_tenant_id, owner_oid, filament_key, finished)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (owner_tenant_id, owner_oid, filament_key)
    DO UPDATE SET finished = excluded.finished, updated_at = datetime('now')`)

  const deleteAdjustment = db.prepare(`
    DELETE FROM filament_roll_adjustments
     WHERE owner_tenant_id = ? AND owner_oid = ? AND filament_key = ?`)

  const listOrders = (owner: Owner): FilamentOrder[] => {
    const lines = new Map<string, FilamentOrderLine[]>()
    for (const row of selectLines.all(owner.tenantId, owner.oid)) {
      lines.set(row.order_id, [...(lines.get(row.order_id) ?? []), rowToLine(row)])
    }
    return selectOrders.all(owner.tenantId, owner.oid).map(row => ({
      id: row.id,
      source: row.source,
      orderNumber: row.order_number,
      orderedAt: row.ordered_at,
      currency: row.currency,
      orderDiscount: row.order_discount,
      credit: row.credit,
      shipping: row.shipping,
      grandTotal: row.grand_total,
      note: row.note,
      createdAt: row.created_at,
      invoice: row.invoice_name && row.invoice_type && row.invoice_bytes
        ? { filename: row.invoice_name, contentType: row.invoice_type, byteLength: row.invoice_bytes }
        : null,
      lines: lines.get(row.id) ?? [],
    }))
  }

  const createTx = db.transaction((owner: Owner, id: string, order: Parameters<FilamentOrderRepository['create']>[1]) => {
    insertOrder.run(id, owner.tenantId, owner.oid, order.source, order.orderNumber, order.orderedAt,
      order.currency, order.orderDiscount, order.credit, order.shipping, order.grandTotal, order.note)
    order.lines.forEach((line, position) => {
      insertLine.run(id, position, line.key, line.variant, line.description, line.sku,
        line.gramsPerUnit, line.quantity, line.unitPrice, line.discount, line.tax)
    })
  })

  return {
    async list(owner) {
      return listOrders(owner)
    },

    async create(owner, order) {
      if (order.orderNumber && findByNumber.get(owner.tenantId, owner.oid, order.orderNumber)) return null
      const id = randomUUID()
      createTx(owner, id, order)
      return listOrders(owner).find(entry => entry.id === id) ?? null
    },

    async attachInvoice(owner, id, invoice) {
      return setInvoice.run(invoice.hash, invoice.filename, invoice.contentType, invoice.byteLength,
        owner.tenantId, owner.oid, id).changes > 0
    },

    async findInvoice(owner, id) {
      const row = selectInvoice.get(owner.tenantId, owner.oid, id)
      if (!row?.invoice_hash || !row.invoice_name || !row.invoice_type) return null
      return { hash: row.invoice_hash, filename: row.invoice_name, contentType: row.invoice_type }
    },

    async delete(owner, id) {
      return deleteOrder.run(owner.tenantId, owner.oid, id).changes > 0
    },

    async listAdjustments(owner) {
      return selectAdjustments.all(owner.tenantId, owner.oid)
        .map((row): FilamentRollAdjustment => ({ key: row.filament_key, finished: row.finished }))
    },

    async setAdjustment(owner, key, finished) {
      if (finished <= 0) deleteAdjustment.run(owner.tenantId, owner.oid, key)
      else upsertAdjustment.run(owner.tenantId, owner.oid, key, finished)
      return selectAdjustments.all(owner.tenantId, owner.oid)
        .map((row): FilamentRollAdjustment => ({ key: row.filament_key, finished: row.finished }))
    },
  }
}
