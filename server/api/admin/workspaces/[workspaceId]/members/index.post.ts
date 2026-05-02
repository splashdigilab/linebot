import { FieldValue } from 'firebase-admin/firestore'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { getFirebaseAuth } from '~~/server/utils/firebase'
import type { WorkspaceMemberRole } from '~~/shared/types/organization'

const VALID_ROLES: WorkspaceMemberRole[] = ['admin', 'agent', 'viewer']

/**
 * POST /api/admin/workspaces/:workspaceId/members
 * 邀請成員加入 workspace。需 admin 以上角色。
 * owner 角色不可透過此 API 指派（只有 seed script 或 org 建立時可設）。
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

  // 透過 email 查 Firebase uid
  let targetUid: string
  try {
    const userRecord = await getFirebaseAuth().getUserByEmail(email.trim())
    targetUid = userRecord.uid
  } catch {
    throw createError({ statusCode: 404, statusMessage: `No Firebase account found for email: ${email}` })
  }

  // 確認尚未是成員
  const db = getDb()
  const memberDocId = `${targetUid}_${workspaceId}`
  const existing = await db.collection('workspaceMembers').doc(memberDocId).get()
  if (existing.exists) {
    throw createError({ statusCode: 409, statusMessage: 'User is already a member of this workspace' })
  }

  // 查詢 organizationId
  const workspaceSnap = await db.collection('workspaces').doc(workspaceId).get()
  const organizationId = workspaceSnap.data()?.organizationId ?? null

  await db.collection('workspaceMembers').doc(memberDocId).set({
    uid: targetUid,
    workspaceId,
    organizationId,
    role,
    invitedBy: inviterUid,
    invitedEmail: email.trim(),
    joinedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  })

  return { id: memberDocId, uid: targetUid, workspaceId, role, invitedEmail: email.trim() }
})
