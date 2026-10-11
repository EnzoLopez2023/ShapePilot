// The positioned text of a PDF, read in the browser.
//
// pdf.js is loaded only when someone actually picks an invoice, so the
// Filaments page does not carry it in its first paint. Reading happens here,
// not on the server: the server is sent the order a person reviewed, and only
// then the PDF, to keep beside it as the receipt.
import type { PdfTextItem } from '../../../../lib/contracts/bambuInvoice.ts'

export async function pdfTextItems(file: Blob): Promise<PdfTextItem[]> {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerSrc } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const document = await task.promise
  try {
    const items: PdfTextItem[] = []
    for (let page = 1; page <= document.numPages; page++) {
      const content = await (await document.getPage(page)).getTextContent()
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        items.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width, page })
      }
    }
    return items
  } finally {
    void task.destroy()
  }
}
