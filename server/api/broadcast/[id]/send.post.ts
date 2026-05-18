import { executeBroadcastSend } from '~~/server/utils/broadcast-send'
import { broadcastScheduleAtToDate } from '~~/server/utils/broadcast-schedule'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { getDoc } from '~~/server/utils/firebase'
import type { BroadcastDoc } from '~~/shared/types/tag-broadcast'

/**
 * POST /api/broadcast/:id/send
 * 立即發送推播
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const doc = await getDoc<BroadcastDoc>('broadcasts', id)
  if (!doc || doc.workspaceId !== workspaceId) {
    throw createError({ statusCode: 404, statusMessage: 'Broadcast not found' })
  }

  if (doc.status === 'scheduled') {
    throw createError({
      statusCode: 409,
      statusMessage: '此推播已排程，請等候自動發送，或先取消排程',
    })
  }

  const scheduledAt = broadcastScheduleAtToDate(doc.scheduleAt)
  if (scheduledAt && scheduledAt.getTime() > Date.now()) {
    throw createError({
      statusCode: 409,
      statusMessage: '此推播已設定未來排程時間，請使用「驗證並排程」或先取消排程',
    })
  }

  try {
    return await executeBroadcastSend(id, { source: 'manual' })
  }
  catch (e: any) {
    const msg = String(e?.message ?? e)
    if (msg.includes('not found')) throw createError({ statusCode: 404, statusMessage: msg })
    if (msg.includes('已排程')) {
      throw createError({ statusCode: 409, statusMessage: msg })
    }
    if (msg.includes('Cannot send') || msg.includes('No messages') || msg.includes('audience')) {
      throw createError({ statusCode: 400, statusMessage: msg })
    }
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
