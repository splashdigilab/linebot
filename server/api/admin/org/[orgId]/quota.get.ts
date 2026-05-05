import { getFirebaseAuth, getDb } from '~~/server/utils/firebase'
import { getWorkspaceQuota } from '~~/server/utils/workspace-quota'

/**
 * GET /api/admin/org/:orgId/quota
 * 查詢該組織的 workspace 使用量與上限。
 * 需為 org admin 或 super admin。
 */
export default defineEventHandler(async (event) => {
  const header = getHeader(event, 'authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  const token = match?.[1]?.trim()
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const decoded = await getFirebaseAuth().verifyIdToken(token).catch(() => {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or expired token' })
  })

  const orgId = event.context.params?.orgId
  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'orgId is required' })

  // super admin 直接放行
  if (decoded['superAdmin'] !== true) {
    const email = decoded.email?.trim().toLowerCase()
    if (!email) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })

    const db = getDb()
    const snap = await db.collection('orgMembers')
      .where('orgId', '==', orgId)
      .where('email', '==', email)
      .limit(1)
      .get()

    if (snap.empty) throw createError({ statusCode: 403, statusMessage: '你不是此組織的管理員' })
  }

  return getWorkspaceQuota(orgId)
})
