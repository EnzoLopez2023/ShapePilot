// A one-sheet workbook of text cells.
//
// The smallest thing Excel, Numbers and the Niimbot label app all open. There
// is no styling, no column sizing and no formulas, because the only consumer is
// an importer that reads the header row and binds columns to template fields.
//
// Every cell is an INLINE string. That is two decisions at once: no
// sharedStrings part to keep in step with the sheet, and no cell ever comes
// back as anything but text -- a filament code like `10501` must not arrive as
// the number 10501, and `#00AE42` must not be mistaken for a formula.
import { zipSync, strToU8 } from 'fflate'

const ENTITIES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
}

const esc = (s: string): string => s.replace(/[&<>"]/g, c => ENTITIES[c])

/** A1, B1 ... Z1, AA1. Spreadsheet columns are bijective base-26, not base-26. */
export function columnName(index: number): string {
  let name = '', n = index + 1
  while (n > 0) {
    const r = (n - 1) % 26
    name = String.fromCharCode(65 + r) + name
    n = (n - r - 1) / 26
  }
  return name
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/xl/workbook.xml"'
  + ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
  + '<Override PartName="/xl/worksheets/sheet1.xml"'
  + ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  + '</Types>'

const RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1"'
  + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
  + ' Target="xl/workbook.xml"/></Relationships>'

const WORKBOOK_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1"'
  + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"'
  + ' Target="worksheets/sheet1.xml"/></Relationships>'

/**
 * Sheet names are stricter than filenames: 31 characters, and none of
 * `[]:*?/\`. A name the rules reject opens as a repair prompt, not an error, so
 * it is cheaper to sanitise here than to explain the prompt.
 */
export const safeSheetName = (name: string): string =>
  name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet1'

export function writeXlsx(
  rows: readonly (readonly string[])[], sheetName = 'Sheet1',
): ArrayBuffer {
  const sheetData = rows.map((row, r) =>
    `<row r="${r + 1}">${row.map((cell, c) =>
      `<c r="${columnName(c)}${r + 1}" t="inlineStr">`
      + `<is><t xml:space="preserve">${esc(cell)}</t></is></c>`,
    ).join('')}</row>`,
  ).join('')

  const zipped = zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
      + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `<sheets><sheet name="${esc(safeSheetName(sheetName))}" sheetId="1" r:id="rId1"/></sheets>`
      + '</workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8(WORKBOOK_RELS),
    'xl/worksheets/sheet1.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + `<sheetData>${sheetData}</sheetData></worksheet>`),
  }, { level: 6 })

  // A plain ArrayBuffer so it drops straight into a Blob.
  return zipped.buffer.slice(
    zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
}

/** RFC 4180, CRLF, and a BOM -- see `LABEL_CSV_MIME` for why the BOM. */
export function writeCsv(rows: readonly (readonly string[])[]): string {
  const body = rows.map(row => row.map(cell =>
    /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell,
  ).join(',')).join('\r\n')
  // Without the BOM Excel reads the file as the local 8-bit codepage and the
  // first casualty is the degree sign in `220 °C`.
  return `\uFEFF${body}\r\n`
}

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const LABEL_CSV_MIME = 'text/csv;charset=utf-8'
