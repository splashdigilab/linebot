import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import type { WorkspaceMemberRole } from '~~/shared/types/organization'

const VALID_ROLES: WorkspaceMemberRole[] = ['admin', 'agent', 'viewer']

/**
 * PUT /api/admin/workspaces/:workspaceId/member-invites/:inviteId
 * 更新待加入邀請的角色。需 admin 以上。
 * Body: { role: 'admin' | 'agent' | 'viewer' }
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const inviteId = getRouterParam(event, 'inviteId')
  if (!inviteId) throw createError({ statusCode: 400, statusMessage: 'inviteId is required' })

  const body = await readBody(event)
  const { role } = body
  if (!VALID_ROLES.includes(role)) {
    throw createError({ statusCode: 400, statusMessage: `role must be one of: ${VALID_ROLES.join(', ')}` })
  }

  const db = getDb()
  const ref = db.collection('workspaceInvites').doc(inviteId)
  const snap = await ref.get()
  if (!snap.exists) throw createError({ statusCode: 404, statusMessage: '找不到此邀請' })
  if (snap.data()?.workspaceId !== workspaceId) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  await ref.update({ role })
  return { id: inviteId, role }
})
