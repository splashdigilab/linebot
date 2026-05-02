import { requireSuperAdmin } from '~~/server/utils/workspace-auth'
import { getFirebaseAuth } from '~~/server/utils/firebase'

/**
 * GET /api/admin/super/users/search?email=xxx
 * 以 email 查詢 Firebase 使用者，含 super admin 狀態。
 */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)

  const query = getQuery(event)
  const email = String(query.email ?? '').trim()
  if (!email) throw createError({ statusCode: 400, statusMessage: 'email is required' })

  const auth = getFirebaseAuth()
  try {
    const user = await auth.getUserByEmail(email)
    const claims = user.customClaims ?? {}
    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName ?? null,
      isSuperAdmin: claims.superAdmin === true,
      disabled: user.disabled,
    }
  } catch {
    throw createError({ statusCode: 404, statusMessage: '找不到此 Email 的使用者' })
  }
})
