/**
 * PDF 切頁工具（掃描檔 OCR 用）。
 *
 * 掃描檔的 OCR 是「單次長呼叫」，整份丟給 Gemini 會超過閘道逾時 → 504。
 * 把 PDF 依頁切成小批（每批獨立成一份子 PDF），一批一次 OCR，
 * 讓每次請求都壓在逾時內；由 preview-jobs 狀態機逐批推進。
 */
import { PDFDocument } from 'pdf-lib'

/** 讀 PDF 頁數。損毀 / 加密會 throw，交給呼叫端轉成可讀錯誤。 */
export async function getPdfPageCount(buffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(new Uint8Array(buffer), { ignoreEncryption: true })
  return doc.getPageCount()
}

/**
 * 從 PDF 抽出 [start, start+count) 這段頁，另存成一份新的子 PDF buffer。
 * start 為 0-based；count 會被夾在實際頁數內。回傳的子 PDF 可直接餵給 ocrPdfWithGemini。
 */
export async function splitPdfPageRange(buffer: Buffer, start: number, count: number): Promise<Buffer> {
  const src = await PDFDocument.load(new Uint8Array(buffer), { ignoreEncryption: true })
  const total = src.getPageCount()
  const from = Math.max(0, Math.min(start, total))
  const to = Math.max(from, Math.min(start + count, total))

  const out = await PDFDocument.create()
  const indices = Array.from({ length: to - from }, (_, i) => from + i)
  if (indices.length > 0) {
    const pages = await out.copyPages(src, indices)
    for (const p of pages) out.addPage(p)
  }
  const bytes = await out.save()
  return Buffer.from(bytes)
}
