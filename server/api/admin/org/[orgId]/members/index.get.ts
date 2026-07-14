import type { Timestamp } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireActiveOrgAdmin } from '~~/server/utils/workspace-auth'
import type { OrganizationDoc } from '~~/shared/types/organization'

/**
 * GET /api/admin/org/:orgId/members — 組織管理員名單（給組織管理員自己看）。
 *
 * 組織管理員是**以 Email 認人**的（不需要對方先註冊過），所以名單上的人可能還沒登入過。
 */
export default defineEventHandler(async (event) => {
  const orgId = event.context.params?.orgId
  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'orgId is required' })

  const { email: myEmail } = await requireActiveOrgAdmin(event, orgId)

  const db = getDb()
  const [orgSnap, snap] = await Promise.all([
    db.collection('organizations').doc(orgId).get(),
    db.collection('orgMembers').where('orgId', '==', orgId).get(),
  ])
  if (!orgSnap.exists) throw createError({ statusCode: 404, statusMessage: '找不到此組織' })

  const ownerEmail = String((orgSnap.data() as OrganizationDoc).ownerEmail ?? '').trim().toLowerCase()

  const members = snap.docs.map((d) => {
    const email = String(d.data().email ?? '').trim().toLowerCase()
    const createdAt = d.data().createdAt as Timestamp | undefined
    return {
      docId: d.id,
      email,
      role: String(d.data().role ?? 'admin'),
      /** 登記擁有者：不可被移除（移掉會讓組織失去帳務歸屬對象）。 */
      isOwner: Boolean(ownerEmail) && email === ownerEmail,
      /** 就是你自己：前端據此提示「不能移除自己」。 */
      isSelf: Boolean(myEmail) && email === myEmail,
      createdAt: typeof createdAt?.toMillis === 'function' ? createdAt.toMillis() : null,
    }
  }).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))

  return { members }
})
