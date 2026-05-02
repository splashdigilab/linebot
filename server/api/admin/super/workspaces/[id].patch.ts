import { FieldValue } from 'firebase-admin/firestore'
import { requireSuperAdmin } from '~~/server/utils/workspace-auth'

/**
 * PATCH /api/admin/super/workspaces/:id
 * 更新 workspace 名稱或所屬組織。Body: { name?, organizationId? }
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
  if ('organizationId' in body) {
    updates.organizationId = body.organizationId ?? null
  }

  const db = getDb()
  const ref = db.collection('workspaces').doc(id)
  const snap = await ref.get()
  if (!snap.exists) throw createError({ statusCode: 404, statusMessage: '找不到此官方帳號' })

  await ref.update(updates)
  return { id, ...snap.data(), ...updates }
})
