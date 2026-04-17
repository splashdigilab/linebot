import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'

/**
 * POST /api/broadcast/:id/cancel
 * 取消尚未開始的草稿或排程推播
 *
 * Response: { success: true, id: string }
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const db = getDb()
  const ref = db.collection('broadcasts').doc(id)
  const snap = await ref.get()

  if (!snap.exists) throw createError({ statusCode: 404, statusMessage: 'Broadcast not found' })

  const { status } = snap.data()!
  const cancellableStatuses = ['draft', 'scheduled']

  if (!cancellableStatuses.includes(status)) {
    throw createError({ statusCode: 409, statusMessage: `Cannot cancel broadcast with status: ${status}` })
  }

  await ref.update({ status: 'cancelled', updatedAt: FieldValue.serverTimestamp() })
  return { success: true, id }
})
