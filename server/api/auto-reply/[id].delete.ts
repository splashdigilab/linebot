import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { invalidateActiveAutoReplyRulesCache } from '~~/server/utils/handler'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  const id = getRouterParam(event, 'id')!
  const db = getDb()
  const existing = await db.collection('autoReplies').doc(id).get()
  if (!existing.exists || existing.data()?.workspaceId !== workspaceId) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  invalidateActiveAutoReplyRulesCache(workspaceId)

  await db.collection('autoReplies').doc(id).delete()
  return { id }
})
