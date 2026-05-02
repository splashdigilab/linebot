import { getDb } from '~~/server/utils/firebase'
import { closeConversationSession } from '~~/server/utils/conversation-session'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')

  const sessionId = getRouterParam(event, 'sessionId')
  if (!sessionId) throw createError({ statusCode: 400, statusMessage: 'sessionId required' })

  const db = getDb()
  const sessionSnap = await db.collection('conversationSessions').doc(sessionId).get()
  if (!sessionSnap.exists || sessionSnap.data()?.workspaceId !== workspaceId) {
    throw createError({ statusCode: 404, statusMessage: '找不到此會話' })
  }

  const userId = sessionSnap.data()!.userId as string
  await closeConversationSession(sessionId, userId)

  return { ok: true }
})
