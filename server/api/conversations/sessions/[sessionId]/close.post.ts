import { getDb } from '~~/server/utils/firebase'
import { closeConversationSession } from '~~/server/utils/conversation-session'
import { requireFirebaseAuth } from '~~/server/utils/admin-auth'

export default defineEventHandler(async (event) => {
  await requireFirebaseAuth(event)
  const sessionId = getRouterParam(event, 'sessionId')
  if (!sessionId) throw createError({ statusCode: 400, statusMessage: 'sessionId required' })

  const db = getDb()
  const sessionSnap = await db.collection('conversationSessions').doc(sessionId).get()
  if (!sessionSnap.exists) throw createError({ statusCode: 404, statusMessage: '找不到此會話' })

  const userId = sessionSnap.data()!.userId as string
  await closeConversationSession(sessionId, userId)

  return { ok: true }
})
