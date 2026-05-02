import { requireSuperAdmin } from '~~/server/utils/workspace-auth'
import { getFirebaseAuth } from '~~/server/utils/firebase'

/**
 * DELETE /api/admin/super/users/:uid/super-admin
 * 撤銷 super admin 身份。
 */
export default defineEventHandler(async (event) => {
  const { uid: callerUid } = await requireSuperAdmin(event)

  const uid = getRouterParam(event, 'uid')
  if (!uid) throw createError({ statusCode: 400, statusMessage: 'uid is required' })
  if (uid === callerUid) throw createError({ statusCode: 400, statusMessage: '不能撤銷自己的 super admin 身份' })

  const auth = getFirebaseAuth()
  let user
  try {
    user = await auth.getUser(uid)
  } catch {
    throw createError({ statusCode: 404, statusMessage: '找不到此使用者' })
  }

  const existing = user.customClaims ?? {}
  const { superAdmin: _, ...rest } = existing as any
  await auth.setCustomUserClaims(uid, rest)

  return { uid, superAdmin: false }
})
