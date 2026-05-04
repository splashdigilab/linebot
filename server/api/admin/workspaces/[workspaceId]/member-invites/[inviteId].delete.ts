import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

/**
 * DELETE /api/admin/workspaces/:workspaceId/member-invites/:inviteId
 * 取消待加入的 email 邀請。需 admin 以上。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const inviteId = getRouterParam(event, 'inviteId')
  if (!inviteId) throw createError({ statusCode: 400, statusMessage: 'inviteId is required' })

  const db = getDb()
  const ref = db.collection('workspaceInvites').doc(inviteId)
  const snap = await ref.get()
  if (!snap.exists) throw createError({ statusCode: 404, statusMessage: '找不到此邀請' })
  if (snap.data()?.workspaceId !== workspaceId) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  await ref.delete()
  return { ok: true }
})
