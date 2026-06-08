import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { listSources } from '~~/server/utils/ai-knowledge-sources'
import { KNOWLEDGE_CHUNKS_COLLECTION } from '~~/server/utils/ai-knowledge-chunks'

/**
 * GET /api/ai/sources/list
 *
 * 回傳：
 *   - items: 所有來源（依 updatedAt 倒序）
 *   - orphanCount: sourceId === null 的舊版手寫卡片數（給 UI 顯示「整理舊資料」橫幅用）
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'viewer')
  const db = getDb()

  const [items, orphanSnap] = await Promise.all([
    listSources(db, workspaceId),
    db.collection(KNOWLEDGE_CHUNKS_COLLECTION)
      .where('workspaceId', '==', workspaceId)
      .where('sourceId', '==', null)
      .count()
      .get(),
  ])

  return {
    items,
    orphanCount: orphanSnap.data().count,
  }
})
