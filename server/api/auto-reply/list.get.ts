import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'viewer')
  const db = getDb()
  const snap = await db.collection('autoReplies')
    .where('workspaceId', '==', workspaceId)
    .orderBy('createdAt', 'desc')
    .get()
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
})
