import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'

/**
 * PUT /api/broadcast/:id
 * 更新草稿或排程中的推播（已開始發送後不可修改）
 *
 * Body（可選欄位）:
 * {
 *   name?: string
 *   audienceSource?: BroadcastAudienceSource
 *   messages?: any[]
 *   scheduleAt?: string | null   // null = 改回草稿
 * }
 *
 * Response: { id: string, ...updatedFields }
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const db = getDb()
  const ref = db.collection('broadcasts').doc(id)
  const snap = await ref.get()

  if (!snap.exists) {
    throw createError({ statusCode: 404, statusMessage: 'Broadcast not found' })
  }

  const current = snap.data()!
  const lockedStatuses = ['processing', 'completed', 'failed']
  if (lockedStatuses.includes(current.status)) {
    throw createError({ statusCode: 409, statusMessage: `Cannot edit a broadcast with status: ${current.status}` })
  }

  const body = await readBody(event)
  const updates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() }

  if (body.name !== undefined) updates.name = body.name
  if (body.audienceSource !== undefined) updates.audienceSource = body.audienceSource
  if (body.messages !== undefined) updates.messages = body.messages

  if (body.scheduleAt !== undefined) {
    if (body.scheduleAt === null) {
      updates.scheduleAt = null
      updates.status = 'draft'
    }
    else {
      updates.scheduleAt = new Date(body.scheduleAt)
      updates.status = 'scheduled'
    }
  }

  await ref.update(updates)
  return { id, ...current, ...updates }
})
