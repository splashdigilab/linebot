import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { KNOWLEDGE_CHUNKS_COLLECTION } from '~~/server/utils/ai-knowledge-chunks'
import { KNOWLEDGE_SOURCES_COLLECTION } from '~~/server/utils/ai-knowledge-sources'

/**
 * DELETE /api/ai/knowledge/:chunkId
 *
 * 若這張卡屬於 type='manual' 的 source（一個 source = 一張卡），刪卡的同時把 source 也刪掉
 * （避免來源列表留下「0 張卡」的孤兒）；若是 file/url 的 source，只更新 chunkCount。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  const chunkId = String(getRouterParam(event, 'chunkId') ?? '').trim()
  if (!chunkId) throw createError({ statusCode: 400, statusMessage: 'chunkId required' })

  const db = getDb()
  const ref = db.collection(KNOWLEDGE_CHUNKS_COLLECTION).doc(chunkId)
  const snap = await ref.get()
  if (!snap.exists) return { ok: true }

  const existing = snap.data() as { workspaceId?: string; sourceId?: string | null }
  if (existing.workspaceId !== workspaceId) {
    throw createError({ statusCode: 403, statusMessage: 'workspace mismatch' })
  }

  await ref.delete()

  // 同步維護 source 的 chunkCount / 若是 manual 單張就一併刪掉 source
  if (existing.sourceId) {
    const sourceRef = db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(existing.sourceId)
    const sourceSnap = await sourceRef.get().catch(() => null)
    if (sourceSnap?.exists) {
      const sourceData = sourceSnap.data() as { type?: string; workspaceId?: string; chunkCount?: number }
      if (sourceData.workspaceId === workspaceId) {
        if (sourceData.type === 'manual') {
          await sourceRef.delete().catch(() => {})
        }
        else {
          await sourceRef.update({
            chunkCount: FieldValue.increment(-1),
            updatedAt: FieldValue.serverTimestamp(),
          }).catch(() => {})
        }
      }
    }
  }

  return { ok: true }
})
