/**
 * 付款（藍新金流）server 側工具：訂單帳本存取、由「已付款方案」組出訂閱物件。
 *
 * 純函式（週期計算、訂單編號、組訂閱）可單元測試;會碰 Firestore 的部分
 * （建單、開通）由 create-order API 與 Notify webhook 呼叫。
 *
 * 付款週期「對齊日曆月（台灣時區）」：則數額度以 aiUsage 的月結桶重置,故本期起訖
 * 也用台灣時區日曆月（taipeiMonthPeriod）,兩者同一把尺、邊界一致,避免跨月被重置
 * 兩次（見 billing Phase 2 規劃）。
 */
import { FieldValue } from 'firebase-admin/firestore'
import type { Firestore, Timestamp } from 'firebase-admin/firestore'
import { getDb } from './firebase'
import { invalidateWorkspaceSubscriptionCache } from './billing'
import { nextCalendarMonthPeriod, taipeiDate, taipeiMonthPeriod } from '~~/shared/time'
import type { BillingPlanId, WorkspaceSubscription } from '~~/shared/billing/plans'
import type { WorkspaceDoc } from '~~/shared/types/organization'
import type { PaymentOrderDoc, PaymentOrderStatus } from '~~/shared/types/payment'

export const PAYMENT_ORDERS_COLLECTION = 'paymentOrders'

const pad = (n: number, len = 2) => String(n).padStart(len, '0')

/**
 * 由「已付款方案」組出 workspace 訂閱物件：active、對齊日曆月、用方案預設額度
 * （不帶 quotaOverride）。付款開通與 super admin 手動開通產出的訂閱形狀一致。
 */
export function buildPaidSubscription(
  planId: BillingPlanId,
  now: Date,
  existingSub?: WorkspaceSubscription | null,
): WorkspaceSubscription {
  const today = taipeiDate(now)
  // 續訂/提前付款:現有訂閱若仍在有效期內,新一期接在現有到期日之後(期間堆疊),
  // 不重設回當月——避免「還沒到期就續訂 → 被重設成同一個月 → 白付一次」。
  const stacking = existingSub != null
    && (existingSub.status === 'active' || existingSub.status === 'trialing')
    && existingSub.currentPeriodEnd != null
    && existingSub.currentPeriodEnd >= today
  const { start, end } = stacking
    ? nextCalendarMonthPeriod(existingSub!.currentPeriodEnd!)
    : taipeiMonthPeriod(now)
  const sub: WorkspaceSubscription = {
    planId,
    status: 'active',
    currentPeriodStart: start,
    currentPeriodEnd: end,
  }
  // 同方案續訂保留 super admin 設定的特批額度;換方案則以新方案預設為準。
  if (existingSub?.planId === planId && existingSub.quotaOverride != null) {
    sub.quotaOverride = existingSub.quotaOverride
  }
  return sub
}

/** 4 碼英數亂數尾碼（訂單編號用）。 */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0')
}

/**
 * 產生藍新 MerchantOrderNo：`NP` + UTC yyyymmddHHMMSS + 4 碼亂數 = 20 碼。
 * 僅英數,符合藍新「限英數、<=30 碼」限制,且足夠唯一。
 */
export function newMerchantOrderNo(now: Date, rand: string = randomSuffix()): string {
  const ts = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`
    + `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  return `NP${ts}${rand}`.slice(0, 30)
}

// ── Firestore 存取 ─────────────────────────────────────────────────

/** 寫入一筆 pending 訂單（建單 API 用）。 */
export async function createPendingOrder(
  order: {
    merchantOrderNo: string
    workspaceId: string
    organizationId?: string | null
    planId: BillingPlanId
    amount: number
    createdBy?: string | null
  },
  db: Firestore = getDb(),
): Promise<void> {
  const doc: PaymentOrderDoc = {
    merchantOrderNo: order.merchantOrderNo,
    workspaceId: order.workspaceId,
    organizationId: order.organizationId ?? null,
    planId: order.planId,
    amount: order.amount,
    status: 'pending',
    tradeNo: null,
    paymentType: null,
    periodStart: null,
    periodEnd: null,
    createdBy: order.createdBy ?? null,
    createdAt: FieldValue.serverTimestamp(),
    paidAt: null,
    updatedAt: FieldValue.serverTimestamp(),
    notifyRaw: null,
  }
  // create()：訂單編號碰撞時失敗（不覆蓋既有訂單）
  await db.collection(PAYMENT_ORDERS_COLLECTION).doc(order.merchantOrderNo).create(doc)
}

/** 建單去重視窗:同帳號同方案在此時間內的 pending 訂單會被沿用,避免連點重複扣款。 */
const PENDING_REUSE_MS = 30 * 60 * 1000

/**
 * 找同帳號、同方案、近 30 分鐘內尚未付款的 pending 訂單以便沿用（沿用同一
 * MerchantOrderNo → 藍新端也會擋掉重複付款）。查詢失敗（如索引未建）回 null,
 * 退化成建新單,不阻斷結帳。
 */
export async function findRecentPendingOrder(
  workspaceId: string,
  planId: BillingPlanId,
  now: Date,
  db: Firestore = getDb(),
): Promise<PaymentOrderDoc | null> {
  try {
    const snap = await db.collection(PAYMENT_ORDERS_COLLECTION)
      .where('workspaceId', '==', workspaceId)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get()
    const cutoff = now.getTime() - PENDING_REUSE_MS
    for (const d of snap.docs) {
      const o = d.data() as PaymentOrderDoc
      if (o.status !== 'pending' || o.planId !== planId) continue
      const ms = (o.createdAt as Timestamp)?.toMillis?.() ?? 0
      if (ms >= cutoff) return o
    }
    return null
  }
  catch (e) {
    console.warn('[payment] findRecentPendingOrder failed (skip dedup):', e)
    return null
  }
}

export interface SettleOrderResult {
  /** 'settled' = 本次成功入帳並開通;'already' = 已是終態(冪等跳過);'unknown' = 查無此訂單 */
  outcome: 'settled' | 'already' | 'unknown'
  workspaceId?: string
  planId?: BillingPlanId
  /** 付款金額與建單金額不符（疑似竄改）；此時標記失敗、不開通 */
  amountMismatch?: boolean
}

/**
 * 依 Notify 結果結算訂單並（成功時）開通訂閱。
 *
 * 用 Firestore transaction 把「訂單狀態」與「workspace 訂閱」原子寫入,並以訂單
 * 現況做冪等：已是 paid/failed/expired 則跳過（藍新會重送 Notify 直到收 200）。
 * 開通成功後清 billing 快取,讓則數額度攔截立即改用新方案。
 */
export async function settlePaidOrder(
  input: {
    merchantOrderNo: string
    paid: boolean
    tradeNo?: string | null
    paymentType?: string | null
    /** Notify 回傳的付款金額；與訂單金額不符則標記失敗、不開通（防竄改） */
    amount?: number
    now: Date
    notifyRaw?: Record<string, unknown> | null
  },
  db: Firestore = getDb(),
): Promise<SettleOrderResult> {
  const orderRef = db.collection(PAYMENT_ORDERS_COLLECTION).doc(input.merchantOrderNo)

  const result = await db.runTransaction<SettleOrderResult>(async (tx) => {
    const snap = await tx.get(orderRef)
    if (!snap.exists) return { outcome: 'unknown' }
    const order = snap.data() as PaymentOrderDoc
    if (order.status !== 'pending') {
      // 已結算過（redelivery）→ 冪等跳過
      return { outcome: 'already', workspaceId: order.workspaceId, planId: order.planId }
    }

    // 讀現有訂閱（續訂堆疊 + 保留 quotaOverride 用）;Firestore 要求所有讀在所有寫之前
    const wsRef = db.collection('workspaces').doc(order.workspaceId)
    let existingSub: WorkspaceSubscription | undefined
    if (input.paid) {
      const wsSnap = await tx.get(wsRef)
      existingSub = wsSnap.exists ? (wsSnap.data() as WorkspaceDoc).subscription : undefined
    }

    const base = {
      tradeNo: input.tradeNo ?? null,
      paymentType: input.paymentType ?? null,
      notifyRaw: input.notifyRaw ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    }

    if (!input.paid) {
      tx.update(orderRef, { ...base, status: 'failed' as PaymentOrderStatus })
      return { outcome: 'settled', workspaceId: order.workspaceId, planId: order.planId }
    }

    if (input.amount != null && input.amount !== order.amount) {
      // 付款金額與建單金額不符（疑似竄改）→ 不開通,標記失敗
      tx.update(orderRef, { ...base, status: 'failed' as PaymentOrderStatus })
      return { outcome: 'settled', workspaceId: order.workspaceId, planId: order.planId, amountMismatch: true }
    }

    const sub = buildPaidSubscription(order.planId, input.now, existingSub)
    tx.update(orderRef, {
      ...base,
      status: 'paid' as PaymentOrderStatus,
      paidAt: FieldValue.serverTimestamp(),
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
    })
    // 同一 transaction 內原子寫入訂閱 → 訂單 paid 與方案開通不會半套
    tx.update(wsRef, {
      subscription: sub,
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { outcome: 'settled', workspaceId: order.workspaceId, planId: order.planId }
  })

  // 開通後清快取（transaction 外，確保已 commit）
  if (result.outcome === 'settled' && result.workspaceId) {
    invalidateWorkspaceSubscriptionCache(result.workspaceId)
  }
  return result
}

// ── 到期對帳（reconcile）──────────────────────────────────────────

/** pending 訂單保留天數:放寬到 4 天以涵蓋 ATM/超商繳費期,逾期才視為 expired（純清理）。 */
const STALE_PENDING_MS = 4 * 24 * 60 * 60 * 1000

/**
 * 是否為「應降級的過期付費訂閱」（陷阱 A）：
 * 只處理付費、已過本期到期日、且仍在計費狀態者;**free / canceled / 無訂閱一律不動**
 * （canceled 維持 grandfather 不攔截,若改成 free/active 反而會開始擋 200 則）。
 */
export function isExpiredPaidSub(sub: WorkspaceSubscription | undefined | null, today: string): boolean {
  if (!sub || sub.planId === 'free' || !sub.currentPeriodEnd) return false
  if (sub.status !== 'active' && sub.status !== 'trialing' && sub.status !== 'past_due') return false
  return sub.currentPeriodEnd < today
}

/** 降級為免費訂閱（active、無到期日;免費靠日曆月自動重置,不會再被對帳降級）。 */
export function buildFreeSubscription(today: string): WorkspaceSubscription {
  return { planId: 'free', status: 'active', currentPeriodStart: today, currentPeriodEnd: null }
}

/**
 * 到期對帳：① 過期付費訂閱 → 降 free（不設 canceled,見陷阱 A）
 *          ② 卡住的 pending 訂單 → expired（純清理,不影響訂閱）。
 * 由排程（Amplify 用 EventBridge 帶 X-Cron-Secret 打 /api/payment/reconcile）每日觸發。
 */
export async function runPaymentReconcile(
  now: Date = new Date(),
  db: Firestore = getDb(),
): Promise<{ downgraded: number; expiredOrders: number }> {
  const today = taipeiDate(now)

  let downgraded = 0
  const expired = await db.collection('workspaces').where('subscription.currentPeriodEnd', '<', today).get()
  for (const doc of expired.docs) {
    const sub = (doc.data() as WorkspaceDoc).subscription
    if (!isExpiredPaidSub(sub, today)) continue
    await doc.ref.update({ subscription: buildFreeSubscription(today), updatedAt: FieldValue.serverTimestamp() })
    invalidateWorkspaceSubscriptionCache(doc.id)
    downgraded++
  }

  let expiredOrders = 0
  const staleCutoffMs = now.getTime() - STALE_PENDING_MS
  const pending = await db.collection(PAYMENT_ORDERS_COLLECTION).where('status', '==', 'pending').get()
  for (const doc of pending.docs) {
    const createdAt = (doc.data() as PaymentOrderDoc).createdAt as Timestamp
    const ms = createdAt && typeof createdAt.toMillis === 'function' ? createdAt.toMillis() : 0
    if (ms && ms < staleCutoffMs) {
      await doc.ref.update({ status: 'expired' as PaymentOrderStatus, updatedAt: FieldValue.serverTimestamp() })
      expiredOrders++
    }
  }

  return { downgraded, expiredOrders }
}
