import { getFirebaseAuth } from '~~/server/utils/firebase'
import { isSuperAdmin } from '~~/server/utils/workspace-auth'

/**
 * GET /api/admin/workspaces/my
 * 回傳目前登入者有加入的所有 workspace（含角色）。
 * Super admin 回傳所有 workspaces。
 */
export default defineEventHandler(async (event) => {
  const header = getHeader(event, 'authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  const token = match?.[1]?.trim()
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const decoded = await getFirebaseAuth().verifyIdToken(token).catch(() => {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or expired token' })
  })

  const db = getDb()

  if (isSuperAdmin(decoded)) {
    // Super admin 看到所有 workspaces
    const snap = await db.collection('workspaces').get()
    return snap.docs.map(d => ({
      workspaceId: d.id,
      name: d.data().name ?? d.id,
      role: 'owner' as const,
      organizationId: d.data().organizationId ?? null,
    }))
  }

  // 一般用戶：查自己的 membership
  const membersSnap = await db.collection('workspaceMembers')
    .where('uid', '==', decoded.uid)
    .get()

  if (membersSnap.empty) return []

  // 取 workspace 名稱
  const workspaceIds = membersSnap.docs.map(d => d.data().workspaceId as string)
  const wsSnap = await db.getAll(
    ...workspaceIds.map(id => db.collection('workspaces').doc(id)),
  )

  const wsNameMap: Record<string, string> = {}
  wsSnap.forEach(d => {
    if (d.exists) wsNameMap[d.id] = (d.data()?.name as string) ?? d.id
  })

  return membersSnap.docs.map(d => {
    const data = d.data()
    return {
      workspaceId: data.workspaceId as string,
      name: wsNameMap[data.workspaceId] ?? data.workspaceId,
      role: data.role as string,
      organizationId: data.organizationId ?? null,
    }
  })
})
