/**
 * 付款（藍新金流）server 側工具：訂單帳本存取、由「已付款方案」組出訂閱物件、
 * 每日續期對帳。
 *
 * 純函式（組訂閱、訂單編號）可單元測試;會碰 Firestore 的部分（建單、開通、對帳）
 * 由 create-order API、Notify webhook 與排程呼叫。
 *
 * **付款週期對齊「錨定日」**（客戶付款那天）,不是日曆月：7/28 付款 → 7/28~8/27。
 * 額度桶 `quotaUsage/{ws}_{periodStart}` 跟著同一把尺,所以月底才升級的人不會付了
 * 整月的錢只買到幾天、額度還被同月份的免費用量吃掉。成本報表仍走日曆月
 * （aiUsage）,兩把尺刻意分開,見 shared/time.ts。
 */
import { FieldValue } from 'firebase-admin/firestore'
import type { Firestore, Timestamp } from 'firebase-admin/firestore'
import { getDb } from './firebase'
import { invalidateWorkspaceSubscriptionCache } from './billing'
import { addDays, dayOfDate, taipeiDate } from '~~/shared/time'
import { isSelfServePaidPlan, type BillingPlanId, type WorkspaceSubscription } from '~~/shared/billing/plans'
import { anchorDayOf, newSubscription, rollSubscriptionToCurrentPeriod } from '~~/shared/billing/period'
import type { WorkspaceDoc } from '~~/shared/types/organization'
import type { PaymentOrderDoc, PaymentOrderStatus } from '~~/shared/types/payment'

export const PAYMENT_ORDERS_COLLECTION = 'paymentOrders'

const pad = (n: number, len = 2) => String(n).padStart(len, '0')

/**
 * 由「已付款方案」組出 workspace 訂閱物件（active、方案預設額度）。
 * 付款開通與 super admin 手動開通產出的訂閱形狀一致。
 *
 * 兩種情形：
 *
 * · **續訂同一個方案且尚未到期** → 期間堆疊：新一期接在現有到期日的隔天,錨定日不變。
 *   避免「還沒到期就提前續訂 → 週期被重設 → 白付一次」。
 *
 * · **從免費升級 / 換方案** → 立刻生效：錨定日重設為付款日,本期從今天起算一整期。
 *   這正是修掉「7/28 付 799 卻只買到 3 天」的地方。
 *
 * ⚠️ 換方案時舊方案的**剩餘天數不折抵**（按比例補差額 proration 留到接定期定額時一起做）。
 *    目前結帳 UI 只做升級,升級的人拿到完整一期,不會吃虧;真要做降級前得先補上折抵。
 */
export function buildPaidSubscription(
  planId: BillingPlanId,
  now: Date,
  existingSub?: WorkspaceSubscription | null,
): WorkspaceSubscription {
  const today = taipeiDate(now)

  const stacking = existingSub != null
    && existingSub.planId === planId
    && isSelfServePaidPlan(planId)
    && existingSub.status !== 'canceled'
    && existingSub.currentPeriodEnd != null
    && existingSub.currentPeriodEnd >= today

  const anchorDay = stacking ? anchorDayOf(existingSub!) : dayOfDate(today)
  const startDate = stacking ? addDays(existingSub!.currentPeriodEnd!, 1) : today

  const sub = newSubscription(planId, startDate, { anchorDay })
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

// ── 每日續期對帳（reconcile）────────────────────────────────────────

/** pending 訂單保留天數:放寬到 4 天以涵蓋 ATM/超商繳費期,逾期才視為 expired（純清理）。 */
const STALE_PENDING_MS = 4 * 24 * 60 * 60 * 1000

/**
 * 每日對帳：① 過期的訂閱 → 滾到當期（免費層補回額度；付費方案沒續費則降回免費）
 *          ② 卡住的 pending 訂單 → expired（純清理,不影響訂閱）。
 *
 * ⚠️ 這支排程是**把結果落地成資料**,不是正確性的前提。真正決定「現在是哪一期、
 *    額度該不該歸零」的是 `rollSubscriptionToCurrentPeriod`,它在每次讀訂閱時就地推算。
 *    所以排程沒跑（Amplify 不跑 scheduledTasks,這個雷踩過）,額度重置與到期降級照樣
 *    正確,只是 Firestore 裡的 subscription 欄位會暫時停留在舊的一期。
 *
 * 由外部排程（EventBridge 帶 X-Cron-Secret 打 /api/payment/reconcile）每日觸發。
 */
export async function runPaymentReconcile(
  now: Date = new Date(),
  db: Firestore = getDb(),
): Promise<{ renewed: number; downgraded: number; expiredOrders: number }> {
  const today = taipeiDate(now)

  let renewed = 0
  let downgraded = 0
  const stale = await db.collection('workspaces').where('subscription.currentPeriodEnd', '<', today).get()
  for (const doc of stale.docs) {
    const sub = (doc.data() as WorkspaceDoc).subscription
    if (!sub) continue
    const rolled = rollSubscriptionToCurrentPeriod(sub, today)
    if (!rolled.changed) continue
    await doc.ref.update({ subscription: rolled.sub, updatedAt: FieldValue.serverTimestamp() })
    invalidateWorkspaceSubscriptionCache(doc.id)
    renewed++
    if (rolled.downgraded) downgraded++
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

  return { renewed, downgraded, expiredOrders }
}
