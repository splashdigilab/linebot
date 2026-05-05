import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { requireSuperAdmin } from '~~/server/utils/workspace-auth'
import { getFirebaseAuth } from '~~/server/utils/firebase'
import { requireWorkspaceQuota } from '~~/server/utils/workspace-quota'

/**
 * POST /api/admin/super/workspaces
 * 建立新 workspace 並設定 owner。
 * Body: { name, ownerEmail, channelAccessToken?, channelSecret?, defaultLiffId?, organizationId? }
 */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)

  const body = await readBody(event)
  const { name, ownerEmail, channelAccessToken, channelSecret, defaultLiffId, organizationId } = body

  if (!name?.trim()) throw createError({ statusCode: 400, statusMessage: 'name is required' })
  if (!ownerEmail?.trim()) throw createError({ statusCode: 400, statusMessage: 'ownerEmail is required' })
  if (!organizationId) throw createError({ statusCode: 400, statusMessage: '請選擇所屬組織' })

  const auth = getFirebaseAuth()
  let ownerUid: string
  try {
    const user = await auth.getUserByEmail(ownerEmail.trim())
    ownerUid = user.uid
  } catch {
    throw createError({ statusCode: 404, statusMessage: '找不到此 Email 的使用者' })
  }

  // 有歸屬組織時才檢查 quota；未歸屬組織的 workspace 由 super admin 自行管控
  if (organizationId) {
    await requireWorkspaceQuota(organizationId)
  }

  const workspaceId = uuidv4()
  const db = getDb()
  const batch = db.batch()

  const wsData: Record<string, unknown> = {
    name: String(name).trim(),
    organizationId: organizationId ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  }
  if (channelAccessToken) wsData.channelAccessToken = channelAccessToken
  if (channelSecret) wsData.channelSecret = channelSecret
  if (defaultLiffId) wsData.defaultLiffId = defaultLiffId

  batch.set(db.collection('workspaces').doc(workspaceId), wsData)

  batch.set(db.collection('workspaceMembers').doc(`${ownerUid}_${workspaceId}`), {
    uid: ownerUid,
    workspaceId,
    organizationId: organizationId ?? null,
    role: 'owner',
    invitedBy: null,
    invitedEmail: ownerEmail.trim(),
    joinedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  })

  await batch.commit()

  return { id: workspaceId, name: String(name).trim(), ownerUid, ownerEmail: ownerEmail.trim() }
})
