import { FieldValue } from 'firebase-admin/firestore'
import { requireSuperAdmin } from '~~/server/utils/workspace-auth'
import { getDb } from '~~/server/utils/firebase'
import { DEMO_LEAD_STATUSES, type DemoLeadStatus } from '~~/shared/types/demo-lead'

/**
 * PATCH /api/admin/super/leads/[id]
 * 更新名單的處理狀態或備註（業務跟進用）。僅 super admin。
 *
 * Body: { status?: DemoLeadStatus, note?: string }
 */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'lead id is required' })
  }

  const body = await readBody(event) as { status?: unknown, note?: unknown }
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }

  if (body.status !== undefined) {
    if (!DEMO_LEAD_STATUSES.includes(body.status as DemoLeadStatus)) {
      throw createError({ statusCode: 400, statusMessage: `status must be one of: ${DEMO_LEAD_STATUSES.join(', ')}` })
    }
    patch.status = body.status
  }

  if (body.note !== undefined) {
    patch.note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : ''
  }

  const db = getDb()
  const ref = db.collection('demoLeads').doc(id)
  const snap = await ref.get()
  if (!snap.exists) {
    throw createError({ statusCode: 404, statusMessage: 'lead not found' })
  }

  await ref.update(patch)
  return { ok: true }
})
