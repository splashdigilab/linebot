import { executeBroadcastSend } from '~~/server/utils/broadcast-send'

/**
 * POST /api/broadcast/:id/send
 * 立即發送推播
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

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
