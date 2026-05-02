import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import type { TagLogDoc } from '~~/shared/types/tag-broadcast'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { lineUserFirestoreDocId, lineUserIdFromFirestoreDocId } from '~~/shared/line-workspace'

/**
 * DELETE /api/users/:id/tags/:tagId
 * 移除單一用戶的某個標籤
 *
 * Response: { success: true, userId: string, tagId: string }
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')

  const userIdParam = getRouterParam(event, 'id')
  const tagId = getRouterParam(event, 'tagId')

  if (!userIdParam || !tagId) {
    throw createError({ statusCode: 400, statusMessage: 'userId and tagId are required' })
  }

  const db = getDb()
  const fsUserDocId = lineUserFirestoreDocId(lineUserIdFromFirestoreDocId(userIdParam))

  // Verify the user belongs to this workspace
  const userSnap = await db.collection('users').doc(fsUserDocId).get()
  if (!userSnap.exists || userSnap.data()?.workspaceId !== workspaceId) {
    throw createError({ statusCode: 404, statusMessage: '找不到此使用者' })
  }

  const docId = `${fsUserDocId}_${tagId}`
  const ref = db.collection('userTags').doc(docId)
  const snap = await ref.get()

  if (!snap.exists) {
    throw createError({ statusCode: 404, statusMessage: 'User does not have this tag' })
  }

  const batch = db.batch()
  batch.delete(ref)

  const logDoc: TagLogDoc = {
    workspaceId,
    action: 'remove',
    userId: fsUserDocId,
    tagId,
    sourceType: 'manual',
    sourceRefId: null,
    operatorId: null,
    createdAt: FieldValue.serverTimestamp(),
  }
  batch.set(db.collection('tagLogs').doc(uuidv4()), logDoc)

  await batch.commit()
  return { success: true, userId: fsUserDocId, tagId }
})
