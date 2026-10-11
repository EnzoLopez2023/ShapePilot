// Dry-run the invoice reader over PDFs on disk. Saves nothing.
//
//   node scripts/parse-invoices.ts ~/Downloads/us7*.pdf
//
// Prints every order as the Orders page would propose it -- each filament line
// matched (or not) to the catalogue, what each roll cost landed, and whether
// the lines add up to the invoice's grand total -- so a batch can be checked
// before any of it is uploaded.
import { readFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { parseBambuInvoice } from '../lib/contracts/bambuInvoice.ts'
import type { PdfTextItem } from '../lib/contracts/bambuInvoice.ts'
import { landedCosts, orderTotal } from '../lib/contracts/filamentOrders.ts'

async function itemsOf(file: string): Promise<PdfTextItem[]> {
  const document = await getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise
  const items: PdfTextItem[] = []
  for (let page = 1; page <= document.numPages; page++) {
    const content = await (await document.getPage(page)).getTextContent()
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      items.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width, page })
    }
  }
  return items
}

let failures = 0
let rolls = 0
for (const file of process.argv.slice(2)) {
  try {
    const { order, warnings } = parseBambuInvoice(await itemsOf(file))
    const costs = landedCosts(order)
    console.log(`\n${order.orderNumber}  ${order.orderedAt}  grand total $${order.grandTotal?.toFixed(2)}`
      + `  lines add to $${orderTotal(order).toFixed(2)}`)
    order.lines.forEach((line, index) => {
      if (!line.key && !line.unmatched) {
        console.log(`  · not filament      ${line.description}`)
        return
      }
      rolls += line.quantity
      const each = costs[index] === null ? 'unpriced' : `$${(costs[index]! / line.quantity).toFixed(2)} each`
      console.log(`  ${line.unmatched ? '✗ UNMATCHED' : '✓'} ${String(line.quantity).padStart(2)} × ${
        line.variant?.padEnd(6)} ${line.key ?? line.description}  ${each}`)
    })
    for (const warning of warnings) console.log(`  ! ${warning}`)
    if (warnings.length) failures += 1
  } catch (error) {
    failures += 1
    console.log(`\n${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
console.log(`\n${rolls} rolls; ${failures} invoice(s) need a look.`)
process.exitCode = failures ? 1 : 0
