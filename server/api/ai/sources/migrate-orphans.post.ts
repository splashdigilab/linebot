import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { KNOWLEDGE_CHUNKS_COLLECTION } from '~~/server/utils/ai-knowledge-chunks'
import { KNOWLEDGE_SOURCES_COLLECTION } from '~~/server/utils/ai-knowledge-sources'

/**
 * POST /api/ai/sources/migrate-orphans
 *
 * 把舊有 sourceId === null 的 chunk「補一個 type='manual' 的 source」包起來，
 * 讓所有資料都在「來源」這層被管理。
 *
 * - 一張 orphan chunk → 一個 manual source（source.name = chunk.title）
 * - 等冪：跑兩次第二次就找不到 orphan，等於 no-op
 * - 單次最多 200 張（避免大爆量）；超過要再跑一次
 */
const MAX_BATCH = 200

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')

  const db = getDb()
  const orphanSnap = await db.collection(KNOWLEDGE_CHUNKS_COLLECTION)
    .where('workspaceId', '==', workspaceId)
    .where('sourceId', '==', null)
    .limit(MAX_BATCH)
    .get()

  if (orphanSnap.empty) {
    return { migrated: 0, capped: false }
  }

  const batch = db.batch()
  const now = FieldValue.serverTimestamp()

  for (const doc of orphanSnap.docs) {
    const data = doc.data() as { title?: string }
    const sourceId = uuidv4()
    const sourceRef = db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(sourceId)

    batch.set(sourceRef, {
      workspaceId,
      type: 'manual',
      name: String(data?.title ?? '').slice(0, 200) || '(未命名)',
      url: '',
      folderId: null,
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

    batch.update(doc.ref, { sourceId, updatedAt: now })
  }

  await batch.commit()

  return {
    migrated: orphanSnap.size,
    capped: orphanSnap.size >= MAX_BATCH,
  }
})
