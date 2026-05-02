import { executeBroadcastSend } from '~~/server/utils/broadcast-send'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { getDoc } from '~~/server/utils/firebase'
import type { BroadcastDoc } from '~~/shared/types/tag-broadcast'

/**
 * POST /api/broadcast/:id/send
 * 立即發送推播
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const doc = await getDoc<BroadcastDoc>('broadcasts', id)
  if (!doc || doc.workspaceId !== workspaceId) {
    throw createError({ statusCode: 404, statusMessage: 'Broadcast not found' })
  }

  try {
    return await executeBroadcastSend(id)
  }
  catch (e: any) {
    const msg = String(e?.message ?? e)
    if (msg.includes('not found')) throw createError({ statusCode: 404, statusMessage: msg })
    if (msg.includes('Cannot send') || msg.includes('No messages') || msg.includes('audience')) {
      throw createError({ statusCode: 400, statusMessage: msg })
    }
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
