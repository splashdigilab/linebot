import { requireSuperAdmin } from '~~/server/utils/workspace-auth'
import { getFirebaseAuth } from '~~/server/utils/firebase'

/**
 * GET /api/admin/super/organizations
 * 列出所有組織，附帶 owner email。
 */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)

  const db = getDb()
  const auth = getFirebaseAuth()

  const snap = await db.collection('organizations').orderBy('createdAt', 'desc').get()
  const orgs = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[]

  // 批次取 owner email
  const uids = [...new Set(orgs.map(o => o.ownerId).filter(Boolean))]
  const emailMap: Record<string, string> = {}
  await Promise.all(uids.map(async (uid) => {
    try {
      const user = await auth.getUser(uid)
      emailMap[uid] = user.email ?? uid
    } catch {
      emailMap[uid] = uid
    }
  }))

  return orgs.map(o => ({
    id: o.id,
    name: o.name,
    plan: o.plan,
    ownerId: o.ownerId,
    ownerEmail: emailMap[o.ownerId] ?? o.ownerId,
    disabled: o.disabled ?? false,
    createdAt: o.createdAt,
  }))
})
