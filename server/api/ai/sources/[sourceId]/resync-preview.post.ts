import { getDb } from '~~/server/utils/firebase'
import { requireCapability } from '~~/server/utils/workspace-auth'
import { getSource } from '~~/server/utils/ai-knowledge-sources'
import { extractUrlText } from '~~/server/utils/ai-source-extractors'
import { chunkTextWithLlm } from '~~/server/utils/ai-knowledge-chunker'
import { computeDiff, loadOldChunksForDiff } from '~~/server/utils/ai-knowledge-resync'
import { recordAiUsage } from '~~/server/utils/ai-usage'

/**
 * POST /api/ai/sources/:sourceId/resync-preview
 *
 * 重新抓 source 的最新內容、跑 LLM 切卡、跟既有 chunk 對比後回傳 diff。
 * **不寫入** Firestore；UI 顯示 diff modal → 使用者勾選 → 再呼叫 resync-apply 套用。
 *
 * 目前只支援 type='url'（檔案需要重新上傳當新 source；手打不需要 re-sync）。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireCapability(event, 'sources.write')
  const sourceId = String(getRouterParam(event, 'sourceId') ?? '').trim()
  if (!sourceId) throw createError({ statusCode: 400, statusMessage: 'sourceId required' })

  const db = getDb()
  const source = await getSource(db, sourceId, workspaceId)
  if (!source) throw createError({ statusCode: 404, statusMessage: 'source not found' })
  if (source.data.type !== 'url' || !source.data.url) {
    throw createError({
      statusCode: 400,
      statusMessage: '目前只支援網址來源 (URL) 的 re-sync；檔案請重新匯入',
    })
  }

  // ── 1. 取最新內容：優先用變動偵測任務暫存的全文（hash 對得上才用），否則重抓 ──
  let extracted: { text: string; rawLength: number }
  const cacheSnap = await db.collection('knowledgeSources').doc(sourceId)
    .collection('cache').doc('extracted')
    .get()
    .catch(() => null)
  const cache = cacheSnap?.data() as { text?: string; hash?: string; rawLength?: number } | undefined
  if (cache?.text && cache.hash && cache.hash === source.data.contentHash) {
    extracted = { text: cache.text, rawLength: Number(cache.rawLength ?? cache.text.length) }
  }
  else {
    extracted = await extractUrlText(source.data.url)
  }
  if (!extracted.text) {
    throw createError({ statusCode: 502, statusMessage: '抓到網頁但內容為空' })
  }

  // ── 2. LLM 切卡 ────────────────────────────────────────
  const { chunks: newChunks, inputTokens, outputTokens } = await chunkTextWithLlm(extracted.text, {
    hint: source.data.name,
  })
  await recordAiUsage(workspaceId, {
    inputTokens,
    outputTokens,
    importInputTokens: inputTokens,
    importOutputTokens: outputTokens,
  }).catch(() => {})

  // ── 3. 拉舊 chunks + 算 diff ──────────────────────────
  const oldChunks = await loadOldChunksForDiff(db, workspaceId, sourceId)
  const diff = computeDiff(oldChunks, newChunks)

  return {
    sourceId,
    sourceName: source.data.name,
    sourceUrl: source.data.url,
    rawLength: extracted.rawLength,
    truncated: extracted.rawLength > extracted.text.length,
    diff,
  }
})
