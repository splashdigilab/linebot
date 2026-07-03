import { FieldValue } from 'firebase-admin/firestore'
import { requireSuperAdmin } from '~~/server/utils/workspace-auth'
import { invalidateWorkspaceSubscriptionCache } from '~~/server/utils/billing'
import { BILLING_PLAN_ORDER } from '~~/shared/billing/plans'
import type { BillingPlanId, SubscriptionStatus, WorkspaceSubscription } from '~~/shared/billing/plans'

const VALID_STATUS: SubscriptionStatus[] = ['active', 'trialing', 'past_due', 'canceled']

/** 驗證並正規化 super admin 傳入的訂閱；null = 取消訂閱（刪除欄位）。 */
function normalizeSubscription(raw: unknown): WorkspaceSubscription | FieldValue {
  if (raw == null) return FieldValue.delete()
  const r = raw as Record<string, unknown>
  const planId = r.planId as BillingPlanId
  if (!BILLING_PLAN_ORDER.includes(planId)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid planId' })
  }
  const status = (r.status ?? 'active') as SubscriptionStatus
  if (!VALID_STATUS.includes(status)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid subscription status' })
  }
  const sub: WorkspaceSubscription = {
    planId,
    status,
    // 首次開通若未帶起始日 → 預設為今天（YYYY-MM-DD）；之後編輯時前端會回傳既有值以保留
    currentPeriodStart: r.currentPeriodStart ? String(r.currentPeriodStart) : new Date().toISOString().slice(0, 10),
    currentPeriodEnd: r.currentPeriodEnd ? String(r.currentPeriodEnd) : null,
  }
  const override = Number(r.quotaOverride)
  if (r.quotaOverride != null && r.quotaOverride !== '' && Number.isFinite(override) && override >= 0) {
    sub.quotaOverride = Math.floor(override)
  }
  const note = String(r.note ?? '').trim()
  if (note) sub.note = note
  return sub
}

/**
 * PATCH /api/admin/super/workspaces/:id
 * 更新 workspace 名稱、所屬組織或計費訂閱。Body: { name?, organizationId?, subscription? }
 *
 * subscription：{ planId, status?, currentPeriodStart?/End?, quotaOverride?, note? }
 *   - null → 取消訂閱（刪欄位，該帳號回到「未開通、不攔截則數」）
 *   - 寫入後清 billing 快取，則數額度攔截即時生效
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
  if ('subscription' in body) {
    updates.subscription = normalizeSubscription(body.subscription)
  }

  const db = getDb()
  const ref = db.collection('workspaces').doc(id)
  const snap = await ref.get()
  if (!snap.exists) throw createError({ statusCode: 404, statusMessage: '找不到此官方帳號' })

  await ref.update(updates)
  // 訂閱可能變更 → 清 billing 快取，讓則數額度攔截立即生效
  invalidateWorkspaceSubscriptionCache(id)

  const after = await ref.get()
  return { id, ...after.data() }
})
