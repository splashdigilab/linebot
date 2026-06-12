import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import {
  KNOWLEDGE_CHUNKS_COLLECTION,
  normalizeChunkInput,
  updateKnowledgeChunk,
  validateChunkInput,
} from '~~/server/utils/ai-knowledge-chunks'
import { KNOWLEDGE_SOURCES_COLLECTION } from '~~/server/utils/ai-knowledge-sources'

/**
 * PUT /api/ai/knowledge/:chunkId
 * Body: { title, content, tags[] }
 *
 * 內容變動會觸發重新索引；只改標題/標籤則保留現有 embedding。
 * 若這張卡屬於 type='manual' 的 source（即「一個 source = 一張卡」的手寫條目），
 * 同步把 source.name 更新成新的 title，讓來源列表的顯示跟著走。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  const chunkId = String(getRouterParam(event, 'chunkId') ?? '').trim()
  if (!chunkId) throw createError({ statusCode: 400, statusMessage: 'chunkId required' })

  const rawBody = await readBody(event)
  const input = normalizeChunkInput(rawBody)
  const err = validateChunkInput(input)
  if (err) throw createError({ statusCode: 400, statusMessage: err })

  const db = getDb()
  const ref = db.collection(KNOWLEDGE_CHUNKS_COLLECTION).doc(chunkId)
  const snap = await ref.get()
  if (!snap.exists) throw createError({ statusCode: 404, statusMessage: 'chunk not found' })
  const existing = snap.data() as { workspaceId?: string; content?: string; sourceId?: string | null; title?: string }
  if (existing.workspaceId !== workspaceId) {
    throw createError({ statusCode: 403, statusMessage: 'workspace mismatch' })
  }

  const contentChanged = (existing.content ?? '') !== input.content
  const titleChanged = (existing.title ?? '') !== input.title

  const result = await updateKnowledgeChunk(db, {
    chunkId,
    // title 也在 embedding 文字裡，改標題同樣要重新索引
    contentChanged: contentChanged || titleChanged,
    manualEdit: true,
    ...input,
  })

  // 若是 manual source 的單張卡 → 同步更新 source.name
  if (titleChanged && existing.sourceId) {
    const sourceRef = db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(existing.sourceId)
    const sourceSnap = await sourceRef.get().catch(() => null)
    if (sourceSnap?.exists) {
      const sourceData = sourceSnap.data() as { type?: string; workspaceId?: string }
      if (sourceData?.type === 'manual' && sourceData.workspaceId === workspaceId) {
        await sourceRef.update({
          name: input.title.slice(0, 200),
          updatedAt: FieldValue.serverTimestamp(),
        }).catch(() => {})
      }
    }
  }

  return {
    id: chunkId,
    status: result.status,
    failureReason: result.failureReason,
    title: input.title,
    content: input.content,
    tags: input.tags,
  }
})
