import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import {
  createKnowledgeChunk,
  normalizeChunkInput,
  validateChunkInput,
} from '~~/server/utils/ai-knowledge-chunks'
import type { KnowledgeChunkStatus, KnowledgeSourceType } from '~~/shared/types/ai-knowledge'

const KNOWLEDGE_SOURCES_COLLECTION = 'knowledgeSources'

/** 同時跑幾張卡的 embedding。Gemini 免費層 RPM 15、付費層 1000+，5 算保守 */
const EMBED_CONCURRENCY = 5

const MAX_BULK_CHUNKS = 50

/**
 * POST /api/ai/knowledge/bulk-create
 * Body: {
 *   source: { type: 'file' | 'url' | 'text', name, url?, contentHash? },
 *   chunks: [{ title, content, tags[] }]
 * }
 *
 * 流程：建 knowledgeSource（type=text 跳過）→ 批次建 chunks（含 embedding）→ 回報每張卡狀態。
 * 失敗的卡會是 status='failed'，可由排程任務或手動 reindex 救回。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  const body = await readBody(event)

  const rawChunks = Array.isArray(body?.chunks) ? body.chunks : []
  if (!rawChunks.length) {
    throw createError({ statusCode: 400, statusMessage: '請至少選擇一張卡片匯入' })
  }
  if (rawChunks.length > MAX_BULK_CHUNKS) {
    throw createError({ statusCode: 400, statusMessage: `單次最多匯入 ${MAX_BULK_CHUNKS} 張卡` })
  }

  const inputs = rawChunks.map(normalizeChunkInput)
  for (const input of inputs) {
    const err = validateChunkInput(input)
    if (err) throw createError({ statusCode: 400, statusMessage: `卡片「${input.title || '未命名'}」：${err}` })
  }

  const db = getDb()

  // ── 建 knowledgeSource（type=text 不建） ────────────────────────
  let sourceId: string | null = null
  const sourceType = String(body?.source?.type ?? '').trim() as KnowledgeSourceType | 'text'
  if (sourceType === 'file' || sourceType === 'url') {
    sourceId = uuidv4()
    const now = FieldValue.serverTimestamp()
    await db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(sourceId).set({
      workspaceId,
      type: sourceType,
      name: String(body?.source?.name ?? '').trim(),
      url: String(body?.source?.url ?? '').trim(),
      filePath: '', // Phase 1b 不存原檔；要存到 Storage 可以擴
      contentHash: String(body?.source?.contentHash ?? '').trim(),
      etag: '',
      lastModified: '',
      refreshIntervalSec: 0,
      refreshIntervalMinutes: sourceType === 'url' ? 1440 : 0, // URL 預設每天偵測；檔案不自動
      onChangeBehavior: 'notify',
      lastFetchedAt: now,
      outdatedAt: null,
      status: 'ready',
      chunkCount: inputs.length,
      createdAt: now,
      updatedAt: now,
    })
  }

  // ── 批次建立 chunks（含 embedding），用 concurrency 控速 ──────────
  type ResultRow = { id: string; status: KnowledgeChunkStatus; title: string; failureReason?: string }
  const results: ResultRow[] = new Array(inputs.length)

  let cursor = 0
  async function worker() {
    while (cursor < inputs.length) {
      const idx = cursor++
      const input = inputs[idx]!
      const chunkId = uuidv4()
      const r = await createKnowledgeChunk(db, {
        workspaceId,
        chunkId,
        ...input,
        sourceId,
      })
      results[idx] = { id: r.id, status: r.status, title: input.title, failureReason: r.failureReason }
    }
  }
  await Promise.all(Array.from({ length: Math.min(EMBED_CONCURRENCY, inputs.length) }, worker))

  const indexed = results.filter(r => r.status === 'indexed').length
  const failed = results.filter(r => r.status === 'failed').length

  return {
    sourceId,
    total: results.length,
    indexed,
    failed,
    items: results,
  }
})
