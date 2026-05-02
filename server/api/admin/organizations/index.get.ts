import { requireWorkspaceAccess, isSuperAdmin } from '~~/server/utils/workspace-auth'
import { getFirebaseAuth } from '~~/server/utils/firebase'

/**
 * GET /api/admin/organizations
 * Super admin only：列出所有 organizations。
 */
export default defineEventHandler(async (event) => {
  const header = getHeader(event, 'authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  const token = match?.[1]?.trim()
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const decoded = await getFirebaseAuth().verifyIdToken(token).catch(() => {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or expired token' })
  })

  if (!isSuperAdmin(decoded)) {
    throw createError({ statusCode: 403, statusMessage: 'Super admin only' })
  }

  const db = getDb()
  const snap = await db.collection('organizations').orderBy('createdAt', 'desc').get()
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
})
