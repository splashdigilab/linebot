import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import {
  createKnowledgeChunk,
  normalizeChunkInput,
  validateChunkInput,
} from '~~/server/utils/ai-knowledge-chunks'
import { KNOWLEDGE_SOURCES_COLLECTION } from '~~/server/utils/ai-knowledge-sources'

/**
 * POST /api/ai/knowledge/create
 * Body: { title, content, tags[], sourceId? }
 *
 * 行為：
 *   - 若 body.sourceId 有值：把這張卡掛到該既有 source 底下（用於「在某 source 內手動補一張」）
 *   - 若 body.sourceId 空：**自動建立 type='manual' 的新 source**，名稱用 title。
 *     這樣手寫單張條目也是「一個 source = 一張卡」，跟 PDF / URL 統一在來源層管理。
 *
 * 同步建立並索引：回傳時 status 已是 indexed（成功）或 failed（embed 出錯）。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  const rawBody = await readBody(event)
  const input = normalizeChunkInput(rawBody)
  const err = validateChunkInput(input)
  if (err) throw createError({ statusCode: 400, statusMessage: err })

  const db = getDb()

  // 若沒指定 sourceId → 自動建一個 type='manual' 的 source
  let sourceId = input.sourceId
  if (!sourceId) {
    sourceId = uuidv4()
    const now = FieldValue.serverTimestamp()
    await db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(sourceId).set({
      workspaceId,
      type: 'manual',
      name: input.title.slice(0, 200),
      url: '',
      folderId: typeof rawBody?.folderId === 'string' ? rawBody.folderId : null,
      filePath: '',
      contentHash: '',
      etag: '',
      lastModified: '',
      refreshIntervalSec: 0,
      refreshIntervalMinutes: 0,
      onChangeBehavior: 'notify',
      lastFetchedAt: now,
      outdatedAt: null,
      status: 'ready',
      chunkCount: 1,
      createdAt: now,
      updatedAt: now,
    })
  }

  const chunkId = uuidv4()
  const result = await createKnowledgeChunk(db, {
    workspaceId,
    chunkId,
    title: input.title,
    content: input.content,
    tags: input.tags,
    sourceId,
  })

  return {
    id: result.id,
    status: result.status,
    failureReason: result.failureReason,
    title: input.title,
    content: input.content,
    tags: input.tags,
    sourceId,
  }
})
