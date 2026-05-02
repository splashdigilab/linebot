import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

/**
 * GET /api/admin/workspaces/:workspaceId/members
 * 列出 workspace 成員列表。需 agent 以上角色。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')

  const db = getDb()
  const snap = await db.collection('workspaceMembers')
    .where('workspaceId', '==', workspaceId)
    .orderBy('createdAt', 'asc')
    .get()

  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
})
