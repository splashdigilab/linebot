import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { AI_USAGE_COLLECTION, currentYyyyMm } from '~~/server/utils/ai-usage'
import { buildPlanView, getWorkspaceSubscription } from '~~/server/utils/billing'
import type { AiUsageDoc } from '~~/shared/types/ai-knowledge'

/**
 * GET /api/ai/usage/plan-summary
 *
 * 輕量端點：只回「目前方案 + 本月已用則數」，供設定頁 / 帳號選單顯示精簡方案卡，
 * 不含完整 KPI（那是 summary）。計費資訊 → 需 admin。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const db = getDb()
  const period = currentYyyyMm()

  const sub = await getWorkspaceSubscription(workspaceId, db)
  const plan = buildPlanView(sub)

  const snap = await db.collection(AI_USAGE_COLLECTION).doc(`${workspaceId}_${period}`).get()
  const answered = snap.exists ? Number((snap.data() as Partial<AiUsageDoc>).answered ?? 0) : 0

  return { period, plan, answered }
})
