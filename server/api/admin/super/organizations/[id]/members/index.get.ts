import { requireSuperAdmin } from '~~/server/utils/workspace-auth'

/**
 * GET /api/admin/super/organizations/:id/members
 * 列出組織管理員（email-based）。
 */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)

  const orgId = getRouterParam(event, 'id')
  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const db = getDb()
  const snap = await db.collection('orgMembers').where('orgId', '==', orgId).get()

  return snap.docs.map(d => ({
    id: d.id, // Firestore doc ID，供刪除用
    email: d.data().email,
    role: d.data().role,
    createdAt: d.data().createdAt,
  }))
})
