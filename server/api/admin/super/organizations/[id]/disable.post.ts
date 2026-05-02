import { FieldValue } from 'firebase-admin/firestore'
import { requireSuperAdmin, invalidateOrgStatusCache } from '~~/server/utils/workspace-auth'

/**
 * POST /api/admin/super/organizations/:id/disable
 * 切換組織停用狀態。Body: { disabled: boolean }
 */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const body = await readBody(event)
  const disabled = Boolean(body.disabled)

  const db = getDb()
  const ref = db.collection('organizations').doc(id)
  const snap = await ref.get()
  if (!snap.exists) throw createError({ statusCode: 404, statusMessage: '找不到此組織' })

  await ref.update({ disabled, updatedAt: FieldValue.serverTimestamp() })
  invalidateOrgStatusCache(id)
  return { id, disabled }
})
