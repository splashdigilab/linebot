import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import type { TagLogDoc } from '~~/shared/types/tag-broadcast'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

/**
 * DELETE /api/users/:id/tags/:tagId
 * 移除單一用戶的某個標籤
 *
 * Response: { success: true, userId: string, tagId: string }
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')

  const userId = getRouterParam(event, 'id')
  const tagId = getRouterParam(event, 'tagId')

  if (!userId || !tagId) {
    throw createError({ statusCode: 400, statusMessage: 'userId and tagId are required' })
  }

  const db = getDb()

  // Verify the user belongs to this workspace
  const userSnap = await db.collection('users').doc(userId).get()
  if (!userSnap.exists || userSnap.data()?.workspaceId !== workspaceId) {
    throw createError({ statusCode: 404, statusMessage: '找不到此使用者' })
  }

  const docId = `${userId}_${tagId}`
  const ref = db.collection('userTags').doc(docId)
  const snap = await ref.get()

  if (!snap.exists) {
    throw createError({ statusCode: 404, statusMessage: 'User does not have this tag' })
  }

  const batch = db.batch()
  batch.delete(ref)

  const logDoc: TagLogDoc = {
    action: 'remove',
    userId,
    tagId,
    sourceType: 'manual',
    sourceRefId: null,
    operatorId: null,
    createdAt: FieldValue.serverTimestamp(),
  }
  batch.set(db.collection('tagLogs').doc(uuidv4()), logDoc)

  await batch.commit()
  return { success: true, userId, tagId }
})
