import { getFirebaseAuth } from '~~/server/utils/firebase'
import { isSuperAdmin } from '~~/server/utils/workspace-auth'

/**
 * GET /api/admin/workspaces/my
 * 回傳目前登入者可存取的所有 workspace（含角色、組織名稱）。
 *
 * 存取來源：
 *   - Super admin：所有 workspace
 *   - 一般用戶：直接 workspace 成員 + 透過 org admin（email-based）取得的 workspace
 *   - 已停用組織的 workspace 對一般用戶隱藏
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

  // ── Super admin ──────────────────────────────────────────────────
  if (isSuperAdmin(decoded)) {
    const [wsSnap, orgSnap] = await Promise.all([
      db.collection('workspaces').get(),
      db.collection('organizations').get(),
    ])
    const orgMap: Record<string, { name: string; disabled: boolean }> = {}
    orgSnap.forEach(d => {
      orgMap[d.id] = { name: d.data().name ?? d.id, disabled: d.data().disabled === true }
    })
    return wsSnap.docs.map(d => {
      const orgId = d.data().organizationId ?? null
      return {
        workspaceId: d.id,
        name: d.data().name ?? d.id,
        role: 'owner' as const,
        organizationId: orgId,
        organizationName: orgId ? (orgMap[orgId]?.name ?? null) : null,
        organizationDisabled: orgId ? (orgMap[orgId]?.disabled ?? false) : false,
        viaOrgAdmin: false,
      }
    })
  }

  // ── 一般用戶 ─────────────────────────────────────────────────────
  const uid = decoded.uid
  const email = decoded.email ?? ''

  // 並行取得：workspace 成員資格 + org 成員資格（email-based）
  const [membersSnap, orgMembersSnap] = await Promise.all([
    db.collection('workspaceMembers').where('uid', '==', uid).get(),
    email ? db.collection('orgMembers').where('email', '==', email).get() : Promise.resolve(null),
  ])

  const adminOrgIds: string[] = orgMembersSnap?.docs.map(d => d.data().orgId as string) ?? []

  // 收集所有相關 org ID
  const wsMemberOrgIds = membersSnap.docs
    .map(d => d.data().organizationId as string | null)
    .filter(Boolean) as string[]
  const allOrgIds = [...new Set([...wsMemberOrgIds, ...adminOrgIds])]

  // 批次取得 org 資料
  const orgDocs = allOrgIds.length > 0
    ? await db.getAll(...allOrgIds.map(id => db.collection('organizations').doc(id)))
    : []

  const orgMap: Record<string, { name: string; disabled: boolean }> = {}
  orgDocs.forEach((d: any) => {
    if (d.exists) orgMap[d.id] = { name: d.data()?.name ?? d.id, disabled: d.data()?.disabled === true }
  })

  // 取得直接成員的 workspace 名稱
  const directWorkspaceIds = membersSnap.docs.map(d => d.data().workspaceId as string)
  const directWsDocs = directWorkspaceIds.length > 0
    ? await db.getAll(...directWorkspaceIds.map(id => db.collection('workspaces').doc(id)))
    : []

  const wsDataMap: Record<string, { name: string; organizationId: string | null }> = {}
  directWsDocs.forEach((d: any) => {
    if (d.exists) wsDataMap[d.id] = { name: d.data()?.name ?? d.id, organizationId: d.data()?.organizationId ?? null }
  })

  const result: any[] = []
  const includedWorkspaceIds = new Set<string>()

  // 直接 workspace 成員（過濾停用組織）
  for (const doc of membersSnap.docs) {
    const data = doc.data()
    const workspaceId = data.workspaceId as string
    const orgId = wsDataMap[workspaceId]?.organizationId ?? data.organizationId ?? null
    if (orgId && orgMap[orgId]?.disabled) continue

    result.push({
      workspaceId,
      name: wsDataMap[workspaceId]?.name ?? workspaceId,
      role: data.role as string,
      organizationId: orgId,
      organizationName: orgId ? (orgMap[orgId]?.name ?? null) : null,
      organizationDisabled: false,
      viaOrgAdmin: false,
    })
    includedWorkspaceIds.add(workspaceId)
  }

  // Org admin 額外可存取的 workspace（排除已停用組織）
  const activeAdminOrgIds = adminOrgIds.filter(id => !orgMap[id]?.disabled)
  if (activeAdminOrgIds.length > 0) {
    const orgWsSnaps = await Promise.all(
      activeAdminOrgIds.map(orgId =>
        db.collection('workspaces').where('organizationId', '==', orgId).get(),
      ),
    )
    orgWsSnaps.forEach((snap, i) => {
      const orgId = activeAdminOrgIds[i]
      snap.docs.forEach(d => {
        if (includedWorkspaceIds.has(d.id)) return
        result.push({
          workspaceId: d.id,
          name: d.data().name ?? d.id,
          role: 'admin' as const,
          organizationId: orgId,
          organizationName: orgMap[orgId]?.name ?? null,
          organizationDisabled: false,
          viaOrgAdmin: true,
        })
        includedWorkspaceIds.add(d.id)
      })
    })
  }

  return result
})
