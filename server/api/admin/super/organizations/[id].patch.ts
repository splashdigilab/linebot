import { FieldValue } from 'firebase-admin/firestore'
import { requireSuperAdmin, invalidateOrgMemberCache } from '~~/server/utils/workspace-auth'
import { getFirebaseAuth } from '~~/server/utils/firebase'
import type { OrganizationPlan } from '~~/shared/types/organization'

function normEmail(e: string | undefined | null): string {
  return String(e ?? '').trim().toLowerCase()
}

/**
 * PATCH /api/admin/super/organizations/:id
 * 更新組織名稱、方案或登記擁有者 Email。Body: { name?, plan?, ownerEmail? }
 *
 * ownerEmail：小寫正規化後寫入；若該 Email 已有 Firebase 帳號則一併寫入 ownerId，否則清除 ownerId。
 * 若新 Email 尚不在 orgMembers，會新增為組織管理員（與建立組織時相同）；既有 org 管理員列不會自動移除。
 */
export default defineEventHandler(async (event) => {
  const { uid: callerUid } = await requireSuperAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const body = await readBody(event)
  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }

  if (body.name !== undefined) {
    if (!String(body.name).trim()) throw createError({ statusCode: 400, statusMessage: 'name cannot be empty' })
    updates.name = String(body.name).trim()
  }
  if (body.plan !== undefined) {
    const validPlans: OrganizationPlan[] = ['free', 'starter', 'pro', 'enterprise']
    if (!validPlans.includes(body.plan)) throw createError({ statusCode: 400, statusMessage: 'invalid plan' })
    updates.plan = body.plan
  }

  const db = getDb()
  const auth = getFirebaseAuth()
  const ref = db.collection('organizations').doc(id)
  const snap = await ref.get()
  if (!snap.exists) throw createError({ statusCode: 404, statusMessage: '找不到此組織' })

  const prev = snap.data() as Record<string, unknown>

  if (body.ownerEmail !== undefined) {
    const newEmail = normEmail(body.ownerEmail)
    if (!newEmail)
      throw createError({ statusCode: 400, statusMessage: 'ownerEmail cannot be empty' })

    const prevEmailRaw = typeof prev.ownerEmail === 'string' ? normEmail(prev.ownerEmail) : ''
    let prevFromUid = ''
    if (prev.ownerId) {
      try {
        prevFromUid = normEmail((await auth.getUser(String(prev.ownerId))).email)
      } catch { /* */ }
    }
    const currentOwner = prevEmailRaw || prevFromUid

    if (newEmail !== currentOwner) {
      updates.ownerEmail = newEmail
      try {
        const user = await auth.getUserByEmail(newEmail)
        updates.ownerId = user.uid
      } catch {
        updates.ownerId = FieldValue.delete() as unknown as string
      }

      const existingOm = await db.collection('orgMembers')
        .where('orgId', '==', id)
        .where('email', '==', newEmail)
        .limit(1)
        .get()
      if (existingOm.empty) {
        await db.collection('orgMembers').add({
          orgId: id,
          email: newEmail,
          role: 'admin',
          invitedBy: callerUid,
          createdAt: FieldValue.serverTimestamp(),
        })
      }

      invalidateOrgMemberCache(newEmail, id)
      if (currentOwner)
        invalidateOrgMemberCache(currentOwner, id)
    }
  }

  await ref.update(updates as never)

  const after = await ref.get()
  const d = after.data() as Record<string, any>
  let ownerEmailOut = typeof d.ownerEmail === 'string' ? d.ownerEmail : ''
  if (!ownerEmailOut && d.ownerId) {
    try {
      ownerEmailOut = (await auth.getUser(String(d.ownerId))).email ?? ''
    } catch { /* */ }
  }

  return {
    id,
    ...d,
    ownerEmail: ownerEmailOut,
  }
})
