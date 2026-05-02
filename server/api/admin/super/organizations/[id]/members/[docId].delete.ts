import { requireSuperAdmin, invalidateOrgMemberCache } from '~~/server/utils/workspace-auth'

/**
 * DELETE /api/admin/super/organizations/:id/members/:docId
 * 移除組織管理員（以 Firestore doc ID 刪除）。
 */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)

  const orgId = getRouterParam(event, 'id')
  const docId = getRouterParam(event, 'docId')
  if (!orgId || !docId) throw createError({ statusCode: 400, statusMessage: 'id and docId are required' })

  const db = getDb()
  const docRef = db.collection('orgMembers').doc(docId)
  const snap = await docRef.get()

  if (!snap.exists || snap.data()?.orgId !== orgId) {
    throw createError({ statusCode: 404, statusMessage: '找不到此成員' })
  }

  const email = snap.data()!.email as string
  await docRef.delete()
  invalidateOrgMemberCache(email, orgId)

  return { docId, email, orgId, removed: true }
})
