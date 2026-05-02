import { requireSuperAdmin } from '~~/server/utils/workspace-auth'
import { getFirebaseAuth } from '~~/server/utils/firebase'

/**
 * POST /api/admin/super/users/:uid/super-admin
 * 授予 super admin 身份。
 */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)

  const uid = getRouterParam(event, 'uid')
  if (!uid) throw createError({ statusCode: 400, statusMessage: 'uid is required' })

  const auth = getFirebaseAuth()
  try {
    await auth.getUser(uid)
  } catch {
    throw createError({ statusCode: 404, statusMessage: '找不到此使用者' })
  }

  const existing = (await auth.getUser(uid)).customClaims ?? {}
  await auth.setCustomUserClaims(uid, { ...existing, superAdmin: true })

  return { uid, superAdmin: true }
})
