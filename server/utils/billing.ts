/**
 * 帳號（workspace/OA）計費：讀訂閱、解析「則數額度」攔截規則。
 *
 * 方案目錄與純函式（額度計算等）在 ~~/shared/billing/plans.ts；這裡只負責
 * 「讀 Firestore 訂閱 + 決定要不要硬性攔截」的 server 側邏輯。
 *
 * 訂閱短暫快取（60s TTL），避免每則 webhook 都打 Firestore；super admin 改動
 * 訂閱後可呼叫 invalidateWorkspaceSubscriptionCache 立即生效。
 */
import type { Firestore } from 'firebase-admin/firestore'
import { getDb } from './firebase'
import type { WorkspaceDoc } from '~~/shared/types/organization'
import type { BillingPlanId, SubscriptionStatus, WorkspaceSubscription } from '~~/shared/billing/plans'
import { DEFAULT_BILLING_PLAN_ID, effectiveAnsweredQuota, getBillingPlan } from '~~/shared/billing/plans'
import type { PlanView } from '~~/shared/billing/plan-state'

const TTL_MS = 60 * 1000

const subCache = new Map<string, { sub: WorkspaceSubscription | null; expiresAt: number }>()

/** 清掉訂閱快取（super admin 開通／改方案後呼叫，讓變更立即生效）。 */
export function invalidateWorkspaceSubscriptionCache(workspaceId?: string) {
  if (workspaceId) subCache.delete(String(workspaceId).trim())
  else subCache.clear()
}

/**
 * 新建帳號（OA）的預設訂閱：免費層、立即生效。
 * 讓新戶一開就看得到自己的免費額度並形成升級漏斗；免費層每月額度靠
 * `aiUsage/{workspaceId}_{yyyyMM}` 依日曆月自動重置，故無固定到期日。
 *
 * ⚠️ 僅用於「新建帳號」。既有未開通租戶維持「無訂閱」（grandfather：不攔截、
 *    不顯示額度）；**不要回填**，以免把老戶誤鎖到 200 則免費額度。
 */
export function defaultFreeSubscription(nowIso: string = new Date().toISOString()): WorkspaceSubscription {
  return {
    planId: DEFAULT_BILLING_PLAN_ID,
    status: 'active',
    currentPeriodStart: nowIso,
    currentPeriodEnd: null,
  }
}

/**
 * 由訂閱組出「對前端顯示用」的方案視圖；未訂閱回 null（grandfather → 前端不顯示額度區塊）。
 * summary / plan-summary 端點共用同一份組法，避免各自拼裝。
 */
export function buildPlanView(sub: WorkspaceSubscription | null): PlanView | null {
  if (!sub) return null
  const p = getBillingPlan(sub.planId)
  return {
    id: p.id,
    name: p.name,
    answeredQuota: effectiveAnsweredQuota(p, sub.quotaOverride),
    overagePerReply: p.overagePerReply,
    currentPeriodEnd: sub.currentPeriodEnd,
  }
}

/** 讀取帳號訂閱（短暫快取）。未設訂閱 / 讀取失敗一律回 null。 */
export async function getWorkspaceSubscription(
  workspaceId: string,
  db: Firestore = getDb(),
): Promise<WorkspaceSubscription | null> {
  const wid = String(workspaceId || '').trim()
  if (!wid) return null

  const now = Date.now()
  const cached = subCache.get(wid)
  if (cached && cached.expiresAt > now) return cached.sub

  let sub: WorkspaceSubscription | null = null
  try {
    const snap = await db.collection('workspaces').doc(wid).get()
    if (snap.exists) sub = (snap.data() as WorkspaceDoc).subscription ?? null
  }
  catch (e) {
    console.warn('[billing] read workspace subscription failed:', e)
  }

  subCache.set(wid, { sub, expiresAt: now + TTL_MS })
  return sub
}

/**
 * 訂閱是否處於「應享方案額度、且應被計量」的狀態。
 * past_due 仍計量（付款失敗但尚未解約，不該因此獲得無限量）；
 * canceled 視為未訂閱（見 resolveAnsweredQuota 的 Phase 1 策略）。
 */
function isEnforceableStatus(status: SubscriptionStatus): boolean {
  return status === 'active' || status === 'trialing' || status === 'past_due'
}

export interface AnsweredQuotaResolution {
  /**
   * 是否對「則數」做硬性攔截。
   * Phase 1 策略：**只有已開通訂閱（active/trialing/past_due）的帳號才擋**；
   * 未開通 / 已解約者不擋（grandfather），仍受既有 token 內部護欄保護——
   * 避免既有正式租戶被 200 則免費額度誤鎖。
   */
  enforce: boolean
  /** 生效額度（含訂閱層 quotaOverride）；null = 不設上限（企業客製未設）。 */
  quota: number | null
  /** 目前方案 ID；未訂閱為 null。 */
  planId: BillingPlanId | null
}

/** 解析某帳號本月「則數額度」的攔截規則。 */
export async function resolveAnsweredQuota(
  workspaceId: string,
  db: Firestore = getDb(),
): Promise<AnsweredQuotaResolution> {
  const sub = await getWorkspaceSubscription(workspaceId, db)
  if (!sub || !isEnforceableStatus(sub.status)) {
    return { enforce: false, quota: null, planId: sub?.planId ?? null }
  }
  const plan = getBillingPlan(sub.planId)
  return {
    enforce: true,
    quota: effectiveAnsweredQuota(plan, sub.quotaOverride),
    planId: plan.id,
  }
}
