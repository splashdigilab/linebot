import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

/**
 * DELETE /api/tag/:id
 *
 * 標籤不做物理刪除，改為 status: 'inactive'
 * 確保歷史貼標紀錄與報表不受影響
 *
 * Response: { success: true, id: string }
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const db = getDb()
  const ref = db.collection('tags').doc(id)
  const snap = await ref.get()

  if (!snap.exists) {
    throw createError({ statusCode: 404, statusMessage: 'Tag not found' })
  }

  if (snap.data()!.workspaceId !== workspaceId) {
    throw createError({ statusCode: 404, statusMessage: 'Tag not found' })
  }

  await ref.update({ status: 'inactive', updatedAt: FieldValue.serverTimestamp() })
  return { success: true, id }
})
