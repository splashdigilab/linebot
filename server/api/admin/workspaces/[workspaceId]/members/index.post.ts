import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { requireWorkspaceAccess, invalidateWorkspaceMemberCache } from '~~/server/utils/workspace-auth'
import { getFirebaseAuth } from '~~/server/utils/firebase'
import type { WorkspaceMemberRole } from '~~/shared/types/organization'

const VALID_ROLES: WorkspaceMemberRole[] = ['admin', 'agent', 'viewer']

function normalizeEmail(raw: string): string {
  return String(raw ?? '').trim().toLowerCase()
}

async function deleteWorkspaceInvitesForEmail(db: Firestore, workspaceId: string, email: string) {
  const snap = await db.collection('workspaceInvites')
    .where('workspaceId', '==', workspaceId)
    .where('email', '==', email)
    .get()
  if (snap.empty) return
  const batch = db.batch()
  snap.docs.forEach(d => batch.delete(d.ref))
  await batch.commit()
}

/**
 * POST /api/admin/workspaces/:workspaceId/members
 * 邀請成員。需 admin 以上角色。
 * - 若對方已有 Firebase 帳號：直接建立 workspaceMembers
 * - 若尚無帳號：寫入 workspaceInvites（email），與組織管理員邀請相同模式，註冊後首次進入後台即轉成成員
 *
 * Body: { email: string, role: 'admin' | 'agent' | 'viewer' }
 */
export default defineEventHandler(async (event) => {
  const { uid: inviterUid, workspaceId } = await requireWorkspaceAccess(event, 'admin')

  const body = await readBody(event)
  const { email, role } = body

  if (!email?.trim()) throw createError({ statusCode: 400, statusMessage: 'email is required' })
  if (!VALID_ROLES.includes(role)) {
    throw createError({ statusCode: 400, statusMessage: `role must be one of: ${VALID_ROLES.join(', ')}` })
  }

  const emailNorm = normalizeEmail(email)
  const db = getDb()

  const pendingSnap = await db.collection('workspaceInvites')
    .where('workspaceId', '==', workspaceId)
    .where('email', '==', emailNorm)
    .limit(1)
    .get()
  if (!pendingSnap.empty) {
    throw createError({ statusCode: 409, statusMessage: '此 Email 已有待處理的邀請' })
  }

  const workspaceSnap = await db.collection('workspaces').doc(workspaceId).get()
  const organizationId = workspaceSnap.data()?.organizationId ?? null

  let targetUid: string | null = null
  try {
    const userRecord = await getFirebaseAuth().getUserByEmail(emailNorm)
    targetUid = userRecord.uid
  } catch {
    targetUid = null
  }

  if (targetUid) {
    const memberDocId = `${targetUid}_${workspaceId}`
    const existing = await db.collection('workspaceMembers').doc(memberDocId).get()
    if (existing.exists) {
      throw createError({ statusCode: 409, statusMessage: 'User is already a member of this workspace' })
    }

    await deleteWorkspaceInvitesForEmail(db, workspaceId, emailNorm)

    await db.collection('workspaceMembers').doc(memberDocId).set({
      uid: targetUid,
      workspaceId,
      organizationId,
      role,
      invitedBy: inviterUid,
      invitedEmail: emailNorm,
      joinedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    })
    invalidateWorkspaceMemberCache(targetUid, workspaceId)

    return { id: memberDocId, uid: targetUid, workspaceId, role, invitedEmail: emailNorm, pending: false }
  }

  const ref = await db.collection('workspaceInvites').add({
    workspaceId,
    organizationId,
    email: emailNorm,
    role,
    invitedBy: inviterUid,
    createdAt: FieldValue.serverTimestamp(),
  })

  return {
    id: ref.id,
    uid: null,
    workspaceId,
    role,
    invitedEmail: emailNorm,
    pending: true,
  }
})
