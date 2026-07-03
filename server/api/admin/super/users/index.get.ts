import { FieldValue } from 'firebase-admin/firestore'
import { requireSuperAdmin } from '~~/server/utils/workspace-auth'
import { getFirebaseAuth } from '~~/server/utils/firebase'

/**
 * GET /api/admin/super/users
 * 列出目前所有 super admin（讀 superAdmins 索引集合），並與 Firebase Auth 對帳。
 *
 * 註:super admin 的權限判斷來源仍是 Firebase custom claim(不可列舉);此集合
 * 只是「可列舉」的索引,讓後台能列出目前有誰。兩者由授予/撤銷端點同步。
 * claimActive 用來揭露漂移(索引有、claim 卻已被移除,例如經 CLI 撤銷)。
 */
export default defineEventHandler(async (event) => {
  const { uid: callerUid, token } = await requireSuperAdmin(event)

  const auth = getFirebaseAuth()
  const col = getDb().collection('superAdmins')

  // 自我補登記:操作者本人已過 requireSuperAdmin(claim 必為 true),若尚未在索引
  // (例如經 CLI 或本功能上線前授予),自動補上,避免清單對本人顯示為空。
  const callerRef = col.doc(callerUid)
  if (!(await callerRef.get()).exists) {
    let email: string | null = token.email ?? null
    let displayName: string | null = null
    try {
      const u = await auth.getUser(callerUid)
      email = u.email ?? email
      displayName = u.displayName ?? null
    } catch { /* Auth 取不到就用 token 的 email */ }
    await callerRef.set({
      email,
      displayName,
      grantedBy: callerUid,
      grantedByEmail: token.email ?? null,
      grantedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }

  const snap = await col.orderBy('grantedAt', 'desc').get()

  return await Promise.all(snap.docs.map(async (d) => {
    const data = d.data() as any
    let email: string = data.email ?? ''
    let displayName: string | null = data.displayName ?? null
    let disabled = false
    let claimActive = false
    let missing = false
    try {
      const user = await auth.getUser(d.id)
      email = user.email ?? email
      displayName = user.displayName ?? displayName
      disabled = user.disabled
      claimActive = (user.customClaims ?? {}).superAdmin === true
    } catch {
      missing = true // Auth 帳號已不存在
    }
    return {
      uid: d.id,
      email,
      displayName,
      disabled,
      claimActive,
      missing,
      isSelf: d.id === callerUid,
      grantedByEmail: data.grantedByEmail ?? null,
    }
  }))
})
