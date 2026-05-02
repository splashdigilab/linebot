import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import type { TagLogDoc } from '~~/shared/types/tag-broadcast'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

const FIRESTORE_BATCH_LIMIT = 400

/**
 * POST /api/user-tags/batch-remove
 * 批次移除多位用戶的一或多個標籤
 *
 * Body:
 * {
 *   userIds: string[]
 *   tagIds: string[]
 * }
 *
 * Response:
 * {
 *   total: number
 *   removed: number
 *   notFound: number
 * }
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')

  const body = await readBody(event)
  const userIds: string[] = body?.userIds ?? []
  const tagIds: string[] = body?.tagIds ?? []

  if (!userIds.length || !tagIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'userIds and tagIds are required' })
  }

  if (userIds.length > 5000) {
    throw createError({ statusCode: 400, statusMessage: 'userIds must not exceed 5000 per request' })
  }

  const db = getDb()
  const now = FieldValue.serverTimestamp()
  let removed = 0
  let notFound = 0

  let batch = db.batch()
  let opsInBatch = 0

  const flushBatch = async () => {
    if (opsInBatch > 0) {
      await batch.commit()
      batch = db.batch()
      opsInBatch = 0
    }
  }

  for (const userId of userIds) {
    for (const tagId of tagIds) {
      const docId = `${userId}_${tagId}`
      const ref = db.collection('userTags').doc(docId)
      const snap = await ref.get()

      if (!snap.exists || snap.data()?.workspaceId !== workspaceId) {
        notFound++
        continue
      }

      batch.delete(ref)
      opsInBatch++

      const logDoc: TagLogDoc = {
        action: 'remove',
        userId,
        tagId,
        sourceType: 'manual',
        sourceRefId: null,
        operatorId: null,
        createdAt: now,
      }
      batch.set(db.collection('tagLogs').doc(uuidv4()), logDoc)
      opsInBatch++
      removed++

      if (opsInBatch >= FIRESTORE_BATCH_LIMIT) {
        await flushBatch()
      }
    }
  }

  await flushBatch()

  return { total: userIds.length * tagIds.length, removed, notFound }
})
