import { FieldValue } from 'firebase-admin/firestore'
import { requireSuperAdmin } from '~~/server/utils/workspace-auth'
import type { OrganizationPlan } from '~~/shared/types/organization'

/**
 * PATCH /api/admin/super/organizations/:id
 * 更新組織名稱或方案。Body: { name?, plan? }
 */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const body = await readBody(event)
  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }

  if (body.name !== undefined) {
    if (!String(body.name).trim()) throw createError({ statusCode: 400, statusMessage: 'name cannot be empty' })
    updates.name = String(body.name).trim()
  }
  if (body.plan !== undefined) {
    const validPlans: OrganizationPlan[] = ['free', 'starter', 'pro', 'enterprise']
    if (!validPlans.includes(body.plan)) throw createError({ statusCode: 400, statusMessage: 'invalid plan' })
    updates.plan = body.plan
  }

  const db = getDb()
  const ref = db.collection('organizations').doc(id)
  const snap = await ref.get()
  if (!snap.exists) throw createError({ statusCode: 404, statusMessage: '找不到此組織' })

  await ref.update(updates)
  return { id, ...snap.data(), ...updates }
})
