import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import {
  extractPdfText,
  extractUrlText,
  extractXlsxText,
  MAX_RAW_TEXT_LEN,
} from '~~/server/utils/ai-source-extractors'
import { chunkTextWithLlm } from '~~/server/utils/ai-knowledge-chunker'
import { getDb } from '~~/server/utils/firebase'
import { KNOWLEDGE_SOURCES_COLLECTION } from '~~/server/utils/ai-knowledge-sources'

/**
 * POST /api/ai/knowledge/preview-chunks
 * Body 三選一：
 *   - { type: 'file', fileName, contentType, fileBase64 }
 *   - { type: 'url', url }
 *   - { type: 'text', text }  ← 手打輸入長文要 AI 切片時用
 *
 * 流程：抽純文字 → LLM 切卡。
 * 純預覽：不寫入 Firestore。客戶端確認後再 POST /bulk-create。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  const body = await readBody(event)
  const type = String(body?.type ?? '').trim()

  let extracted: { text: string; rawLength: number; meta: Record<string, string | number> }
  let sourceName = ''
  let sourceUrl = ''

  if (type === 'file') {
    const fileName = String(body?.fileName ?? '').trim()
    const contentType = String(body?.contentType ?? '').trim().toLowerCase()
    const base64 = String(body?.fileBase64 ?? '').trim()
    if (!fileName || !base64) {
      throw createError({ statusCode: 400, statusMessage: '請提供 fileName 與 fileBase64' })
    }
    const buffer = Buffer.from(base64, 'base64')
    if (buffer.length === 0) {
      throw createError({ statusCode: 400, statusMessage: '檔案內容為空' })
    }
    if (buffer.length > 10 * 1024 * 1024) {
      throw createError({ statusCode: 400, statusMessage: '檔案超過 10MB 上限' })
    }

    sourceName = fileName
    const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
    const isPdf = contentType.includes('pdf') || ext === 'pdf'
    const isXlsx = contentType.includes('spreadsheet') || contentType.includes('excel')
      || ext === 'xlsx' || ext === 'xls'

    if (isPdf) extracted = await extractPdfText(buffer)
    else if (isXlsx) extracted = extractXlsxText(buffer)
    else throw createError({ statusCode: 400, statusMessage: `不支援的檔案類型：${ext || contentType}` })
  }
  else if (type === 'url') {
    const url = String(body?.url ?? '').trim()
    if (!url) throw createError({ statusCode: 400, statusMessage: '請輸入網址' })
    extracted = await extractUrlText(url)
    sourceName = url
    sourceUrl = url
  }
  else if (type === 'text') {
    const text = String(body?.text ?? '').trim()
    if (!text) throw createError({ statusCode: 400, statusMessage: '請輸入要切片的文字' })
    if (text.length > MAX_RAW_TEXT_LEN) {
      throw createError({ statusCode: 400, statusMessage: `文字超過 ${MAX_RAW_TEXT_LEN} 字上限` })
    }
    extracted = { text, rawLength: text.length, meta: {} }
    sourceName = String(body?.name ?? '手打輸入').trim()
  }
  else {
    throw createError({ statusCode: 400, statusMessage: '請指定 type: file / url / text' })
  }

  if (!extracted.text) {
    throw createError({ statusCode: 400, statusMessage: '抽出純文字後為空；請確認檔案或連結內容' })
  }

  // 切卡
  const { chunks, inputTokens, outputTokens } = await chunkTextWithLlm(extracted.text, {
    hint: sourceName,
  })

  // 偵測同名來源（給前端顯示 dedup 警告用；不阻擋建立，只提醒）
  let existingMatches: Array<{ id: string; name: string; chunkCount: number; updatedAtMs: number }> = []
  if (sourceName && (type === 'file' || type === 'url')) {
    try {
      const db = getDb()
      const snap = await db.collection(KNOWLEDGE_SOURCES_COLLECTION)
        .where('workspaceId', '==', workspaceId)
        .where('name', '==', sourceName)
        .limit(5)
        .get()
      existingMatches = snap.docs.map((d) => {
        const data = d.data() as any
        const ts = data?.updatedAt
        const sec = ts?._seconds ?? ts?.seconds
        return {
          id: d.id,
          name: String(data?.name ?? ''),
          chunkCount: Number(data?.chunkCount ?? 0),
          updatedAtMs: typeof sec === 'number' ? sec * 1000 : 0,
        }
      })
    }
    catch (e) {
      console.warn('[preview-chunks] dedup check failed:', e)
    }
  }

  return {
    sourceName,
    sourceUrl,
    sourceType: type,
    rawLength: extracted.rawLength,
    truncated: extracted.rawLength > extracted.text.length,
    meta: extracted.meta,
    chunks,
    existingMatches,
    usage: { inputTokens, outputTokens },
  }
})
