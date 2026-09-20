import assert from 'node:assert/strict'
import { test } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { FILAMENT_CATALOG, filamentByKey } from '../../../../lib/contracts/bambuFilaments.ts'
import {
  LABEL_COLUMNS, PRINT_SETTINGS, labelRow, labelSheet, linesWithoutSettings, qrFor,
} from './labels.ts'
import { columnName, safeSheetName, writeCsv, writeXlsx } from '../../../export/xlsx.ts'

const GREEN = 'bambu-lab/pla/basic/bambu-green-10501'

test('a label says what the reference card says', () => {
  const color = filamentByKey(GREEN)
  assert.ok(color)
  assert.deepEqual(labelRow(color, 'profile'), [
    'Bambu Lab', 'PLA Basic', 'Bambu Green', '200 mm/s', '220 °C', '10501',
    'https://3dfilamentprofiles.com/filaments/bambu-lab/pla/basic',
    '#00AE42', GREEN,
  ])
})

test('every catalogue line has printing figures', () => {
  assert.deepEqual(linesWithoutSettings(FILAMENT_CATALOG), [])
})

test('every temperature is a plausible nozzle temperature', () => {
  for (const [line, { speed, temp }] of Object.entries(PRINT_SETTINGS)) {
    const degrees = Number(temp.replace(' °C', ''))
    assert.ok(degrees >= 180 && degrees <= 300, `${line} prints at ${temp}`)
    assert.match(speed, /^\d+ mm\/s$/, `${line} speed is ${speed}`)
  }
})

test('the QR modes are the three we offer, and none is empty by accident', () => {
  const color = filamentByKey(GREEN)
  assert.ok(color)
  assert.equal(qrFor(color, 'key'), GREEN)
  assert.equal(qrFor(color, 'none'), '')
  assert.ok(qrFor(color, 'profile').startsWith('https://'))
})

test('the sheet leads with the header and sorts by line then colour', () => {
  const rows = labelSheet(FILAMENT_CATALOG)
  assert.deepEqual(rows[0], [...LABEL_COLUMNS])
  assert.equal(rows.length, FILAMENT_CATALOG.length + 1)
  const body = rows.slice(1)
  // key is `<line>/<colour-slug>-<code>`, so the line is its first three parts.
  const order = body.map(row => [row[8]!.split('/').slice(0, 3).join('/'), row[2]!])
  const sorted = [...order].sort((a, b) => a[0]!.localeCompare(b[0]!) || a[1]!.localeCompare(b[1]!))
  assert.deepEqual(order, sorted, 'rows must come off the printer grouped by line')
  // Every row has a cell for every column -- a short row shifts the bindings.
  for (const row of body) assert.equal(row.length, LABEL_COLUMNS.length)
})

test('the workbook is a readable zip whose cells are all text', () => {
  const rows = labelSheet([filamentByKey(GREEN)!])
  const parts = unzipSync(new Uint8Array(writeXlsx(rows, 'Filaments')))
  assert.deepEqual(Object.keys(parts).sort(), [
    '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels',
    'xl/workbook.xml', 'xl/worksheets/sheet1.xml',
  ])
  const sheet = strFromU8(parts['xl/worksheets/sheet1.xml']!)
  // Inline strings only: a code like 10501 must not come back as a number.
  assert.equal(sheet.includes('t="inlineStr"'), true)
  assert.equal(/<c [^>]*t="n"/.test(sheet), false)
  assert.ok(sheet.includes('<t xml:space="preserve">10501</t>'))
  assert.ok(sheet.includes('220 °C'))
  assert.ok(strFromU8(parts['xl/workbook.xml']!).includes('name="Filaments"'))
})

test('a cell that looks like markup survives the round trip', () => {
  const sheet = strFromU8(
    unzipSync(new Uint8Array(writeXlsx([['a&b', '<c>', '"d"']])))['xl/worksheets/sheet1.xml']!)
  assert.ok(sheet.includes('a&amp;b'))
  assert.ok(sheet.includes('&lt;c&gt;'))
  assert.ok(sheet.includes('&quot;d&quot;'))
})

test('columns run past Z the way a spreadsheet numbers them', () => {
  assert.deepEqual([0, 25, 26, 27, 51, 52].map(columnName), ['A', 'Z', 'AA', 'AB', 'AZ', 'BA'])
})

test('a sheet name Excel would refuse is sanitised rather than passed on', () => {
  assert.equal(safeSheetName('a/b:c*d?e[f]g'), 'a b c d e f g')
  assert.equal(safeSheetName('   '), 'Sheet1')
  assert.equal(safeSheetName('x'.repeat(40)).length, 31)
})

test('the CSV is BOM-first, CRLF, and quotes what needs it', () => {
  const csv = writeCsv([['a', 'b'], ['x,y', 'he said "hi"']])
  assert.equal(csv.charCodeAt(0), 0xFEFF)
  assert.ok(csv.endsWith('\r\n'))
  assert.ok(csv.includes('"x,y"'))
  assert.ok(csv.includes('"he said ""hi"""'))
})
