import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { buildEmbeddingText, KNOWLEDGE_CHUNKS_COLLECTION, runIndexOnChunk } from '~~/server/utils/ai-knowledge-chunks'

/**
 * POST /api/ai/knowledge/:chunkId/reindex
 *
 * 手動觸發單張卡重新算 embedding。供「索引失敗」狀態下使用者點重試。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  const chunkId = String(getRouterParam(event, 'chunkId') ?? '').trim()
  if (!chunkId) throw createError({ statusCode: 400, statusMessage: 'chunkId required' })

  const db = getDb()
  const ref = db.collection(KNOWLEDGE_CHUNKS_COLLECTION).doc(chunkId)
  const snap = await ref.get()
  if (!snap.exists) throw createError({ statusCode: 404, statusMessage: 'chunk not found' })
  const data = snap.data() as { workspaceId?: string; title?: string; content?: string; questions?: unknown }
  if (data.workspaceId !== workspaceId) {
    throw createError({ statusCode: 403, statusMessage: 'workspace mismatch' })
  }
  const content = String(data.content ?? '').trim()
  if (!content) throw createError({ statusCode: 400, statusMessage: 'chunk has no content' })

  return runIndexOnChunk(db, chunkId, buildEmbeddingText(
    String(data.title ?? ''),
    content,
    Array.isArray(data.questions) ? data.questions.map(String) : [],
  ))
})
