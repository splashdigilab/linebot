import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireOrgAdmin } from '~~/server/utils/workspace-auth'
import { addSystemModulesToBatch } from '~~/server/utils/workspace-system-modules'

/**
 * POST /api/admin/org/:orgId/workspaces
 * 組織 owner / admin 在限額內自行建立官方帳號。
 * 請求者自動成為新 workspace 的 owner。
 * Body: { name }
 */
export default defineEventHandler(async (event) => {
  const orgId = event.context.params?.orgId
  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'orgId is required' })

  const { uid, email } = await requireOrgAdmin(event, orgId)
  // super admin 可能沒有 orgMembers email；建立時以其 token email 記錄，無則留空
  const inviterEmail = email ?? null

  const db = getDb()

  // 確認組織未停用
  const orgSnap = await db.collection('organizations').doc(orgId).get()
  if (!orgSnap.exists) throw createError({ statusCode: 404, statusMessage: '找不到此組織' })
  if (orgSnap.data()?.disabled === true) {
    throw createError({ statusCode: 403, statusMessage: '此組織已停用' })
  }

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

  batch.set(db.collection('workspaceMembers').doc(`${uid}_${workspaceId}`), {
    uid,
    workspaceId,
    organizationId: orgId,
    role: 'owner',
    invitedBy: null,
    invitedEmail: inviterEmail,
    joinedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  })

  addSystemModulesToBatch(db, batch, workspaceId)

  await batch.commit()

  return { id: workspaceId, name }
})
