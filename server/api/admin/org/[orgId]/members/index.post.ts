import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { invalidateOrgMemberCache, requireActiveOrgAdmin } from '~~/server/utils/workspace-auth'

/**
 * POST /api/admin/org/:orgId/members — 新增組織管理員。Body: { email }
 *
 * 以 Email 認人，不需要對方已有 Firebase 帳號——他下次用這個 Google 信箱登入就會直接生效。
 * 這也是為什麼「沒有權限」的畫面要把登入信箱顯示出來：邀請他的人需要的就是那個字串。
 *
 * ⚠️ 組織管理員是**組織底下所有官方帳號的 admin**（見 workspace-auth.ts），
 *    等於把整個組織的權限交出去。這不是一個輕的動作，前端要問清楚。
 *
 * ⚠️ 目前**沒有邀請信**——加進來的人不會收到任何通知，得靠邀請者自己告訴他。
 *    寄信管道還沒建（見 docs/TODO.md）。
 */
export default defineEventHandler(async (event) => {
  const orgId = event.context.params?.orgId
  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'orgId is required' })

  const { uid } = await requireActiveOrgAdmin(event, orgId)

  const db = getDb()
  // 停用檢查已由 requireActiveOrgAdmin 統一處理
  const orgSnap = await db.collection('organizations').doc(orgId).get()
  if (!orgSnap.exists) throw createError({ statusCode: 404, statusMessage: '找不到此組織' })

  const body = await readBody(event)
  const email = String(body?.email ?? '').trim().toLowerCase()
  if (!email) throw createError({ statusCode: 400, statusMessage: '請輸入 Email' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, statusMessage: 'Email 格式不正確' })
  }

  const existing = await db.collection('orgMembers')
    .where('orgId', '==', orgId)
    .where('email', '==', email)
    .limit(1)
    .get()
  if (!existing.empty) throw createError({ statusCode: 409, statusMessage: '此 Email 已是組織管理員' })

  const ref = await db.collection('orgMembers').add({
    orgId,
    email,
    role: 'admin',
    invitedBy: uid,
    createdAt: FieldValue.serverTimestamp(),
  })

  invalidateOrgMemberCache(email, orgId)
  return { docId: ref.id, email, role: 'admin' }
})
