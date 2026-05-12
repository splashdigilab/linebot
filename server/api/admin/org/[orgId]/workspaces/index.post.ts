import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { getFirebaseAuth, getDb } from '~~/server/utils/firebase'
import { requireWorkspaceQuota } from '~~/server/utils/workspace-quota'
import { addSystemModulesToBatch } from '~~/server/utils/workspace-system-modules'

/**
 * POST /api/admin/org/:orgId/workspaces
 * 組織 owner / admin 在限額內自行建立官方帳號。
 * 請求者自動成為新 workspace 的 owner。
 * Body: { name }
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

  const email = decoded.email?.trim().toLowerCase()
  if (!email) throw createError({ statusCode: 403, statusMessage: 'Email is required' })

  const db = getDb()

  // 確認此 user 是該 org 的管理員
  const orgMemberSnap = await db.collection('orgMembers')
    .where('orgId', '==', orgId)
    .where('email', '==', email)
    .limit(1)
    .get()

  if (orgMemberSnap.empty) {
    throw createError({ statusCode: 403, statusMessage: '你不是此組織的管理員' })
  }

  // 確認組織未停用
  const orgSnap = await db.collection('organizations').doc(orgId).get()
  if (!orgSnap.exists) throw createError({ statusCode: 404, statusMessage: '找不到此組織' })
  if (orgSnap.data()?.disabled === true) {
    throw createError({ statusCode: 403, statusMessage: '此組織已停用' })
  }

  // Quota 檢查
  await requireWorkspaceQuota(orgId)

  const body = await readBody(event)
  const name = body?.name?.trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: '請輸入官方帳號名稱' })

  const workspaceId = uuidv4()
  const batch = db.batch()

  batch.set(db.collection('workspaces').doc(workspaceId), {
    name,
    organizationId: orgId,
    updatedAt: FieldValue.serverTimestamp(),
  })

  batch.set(db.collection('workspaceMembers').doc(`${decoded.uid}_${workspaceId}`), {
    uid: decoded.uid,
    workspaceId,
    organizationId: orgId,
    role: 'owner',
    invitedBy: null,
    invitedEmail: email,
    joinedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  })

  addSystemModulesToBatch(db, batch, workspaceId)

  await batch.commit()

  return { id: workspaceId, name }
})
