import { FieldValue } from 'firebase-admin/firestore'
import { assertFutureBroadcastScheduleAt } from '~~/server/utils/broadcast-schedule'
import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

/**
 * POST /api/broadcast/:id/schedule
 * 確認排程（不發送）。僅允許 draft / scheduled 狀態。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const db = getDb()
  const ref = db.collection('broadcasts').doc(id)
  const snap = await ref.get()

  if (!snap.exists) throw createError({ statusCode: 404, statusMessage: 'Broadcast not found' })

  const current = snap.data()!
  if (current.workspaceId !== workspaceId) {
    throw createError({ statusCode: 404, statusMessage: 'Broadcast not found' })
  }

  const lockedStatuses = ['processing', 'completed', 'failed', 'cancelled']
  if (lockedStatuses.includes(current.status)) {
    throw createError({ statusCode: 409, statusMessage: `Cannot schedule broadcast with status: ${current.status}` })
  }

  const body = await readBody(event)
  if (!body?.scheduleAt) {
    throw createError({ statusCode: 400, statusMessage: 'scheduleAt is required' })
  }

  const scheduleAt = assertFutureBroadcastScheduleAt(body.scheduleAt)
  const updates: Record<string, unknown> = {
    status: 'scheduled',
    scheduleAt,
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (body.name !== undefined) updates.name = body.name
  if (body.audienceSource !== undefined) updates.audienceSource = body.audienceSource
  if (body.messages !== undefined) updates.messages = body.messages

  await ref.update(updates)

  return {
    success: true,
    id,
    status: 'scheduled',
    scheduleAt: scheduleAt.toISOString(),
  }
})
