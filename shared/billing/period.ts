// ═══════════════════════════════════════════════════════════════════
//  訂閱週期（純函式，前後端共用）
//
//  週期對齊「錨定日」——客戶開始訂閱的那一天,每期都在這天續期
//  （7/28 訂閱 → 7/28~8/27 → 8/28~9/27）。則數額度隨週期重置,不是每月 1 號。
//
//  ⚠️ 設計重點：**週期是「讀取時就地推算」出來的,不是靠排程去寫出來的。**
//     `rollSubscriptionToCurrentPeriod` 是純函式,每次讀訂閱都會把它推到「包含今天的
//     那一期」。所以就算每日排程沒跑（Amplify 不跑 scheduledTasks,這個雷踩過),
//     額度重置與到期降級仍然正確——排程只是把結果落地成 Firestore 資料,
//     不是正確性的前提。
// ═══════════════════════════════════════════════════════════════════

import { anchoredPeriod, dayOfDate, nextAnchoredPeriod, normalizeAnchorDay } from '../time'
import { isSelfServePaidPlan, type BillingPlanId, type WorkspaceSubscription } from './plans'

/** 休眠帳號的推進上限（50 年）；純防呆,正常永遠碰不到。 */
const MAX_ROLL_ITERATIONS = 600

/**
 * 訂閱的錨定日。舊資料沒有 anchorDay 欄位 → 由本期起日推回（第一次讀到就會被補上）。
 */
export function anchorDayOf(sub: WorkspaceSubscription): number {
  if (sub.anchorDay) return normalizeAnchorDay(sub.anchorDay)
  if (sub.currentPeriodStart) return normalizeAnchorDay(dayOfDate(sub.currentPeriodStart))
  return 1
}

/** 從某天起算一份新訂閱（錨定日預設 = 起始日當天）。 */
export function newSubscription(
  planId: BillingPlanId,
  startDate: string,
  opts?: { anchorDay?: number; status?: WorkspaceSubscription['status'] },
): WorkspaceSubscription {
  const anchorDay = normalizeAnchorDay(opts?.anchorDay ?? dayOfDate(startDate))
  const { start, end } = anchoredPeriod(startDate, anchorDay)
  return {
    planId,
    status: opts?.status ?? 'active',
    currentPeriodStart: start,
    currentPeriodEnd: end,
    anchorDay,
  }
}

export interface RolledSubscription {
  sub: WorkspaceSubscription
  /** 有沒有被改動（排程據此決定要不要寫回 Firestore）。 */
  changed: boolean
  /** 是否因為到期沒續費而被降回免費層。 */
  downgraded: boolean
}

/**
 * 把訂閱推進到「包含 today 的那一期」。純函式,不碰 Firestore。
 *
 * 做三件事：
 *   ① 補完週期（舊資料 / super admin 手動開通可能只有半套）
 *   ② 一期一期往前滾,直到 today 落在本期內 → 這就是「額度重置」
 *   ③ 自助付費方案（lite/starter/growth/pro）滾過到期日 = 沒續費 → 降回免費層
 *
 * 免費層、enterprise、test/internal 只滾週期不降級：前者本來就是最低層,
 * 後兩者由人管理（合約 / super admin 指派）,不該被自動降掉。
 */
export function rollSubscriptionToCurrentPeriod(
  input: WorkspaceSubscription,
  today: string,
): RolledSubscription {
  // 完全沒有週期資料的舊訂閱 → 錨定日取「今天」,而不是預設的 1 號。
  // （否則 7/28 才第一次被讀到的舊帳號會拿到 7/28~7/31 這種只有 4 天的畸形首期。）
  const anchorDay = input.anchorDay || input.currentPeriodStart
    ? anchorDayOf(input)
    : normalizeAnchorDay(dayOfDate(today))

  let sub: WorkspaceSubscription = { ...input }
  let changed = false
  let downgraded = false

  // ⓪ 日期一律正規化成 YYYY-MM-DD。舊版曾把 currentPeriodStart 寫成完整 ISO
  //    （2026-07-03T00:00:00.000Z）;不切掉的話它會原樣變成額度桶的 doc id。
  const normStart = input.currentPeriodStart?.slice(0, 10) ?? null
  const normEnd = input.currentPeriodEnd?.slice(0, 10) ?? null
  if (normStart !== input.currentPeriodStart || normEnd !== input.currentPeriodEnd) {
    sub = { ...sub, currentPeriodStart: normStart, currentPeriodEnd: normEnd }
    changed = true
  }

  // ① 週期不完整（舊資料、手動開通沒填到期日）→ 就地補一期
  if (!sub.currentPeriodStart || !sub.currentPeriodEnd) {
    const p = anchoredPeriod(sub.currentPeriodStart || today, anchorDay)
    sub = { ...sub, currentPeriodStart: p.start, currentPeriodEnd: p.end }
    changed = true
  }
  if (sub.anchorDay !== anchorDay) {
    sub = { ...sub, anchorDay }
    changed = true
  }

  // ② + ③ 滾到包含今天的那一期；付費方案滾過到期日就是沒續費
  let guard = 0
  while (sub.currentPeriodEnd! < today && guard++ < MAX_ROLL_ITERATIONS) {
    const p = nextAnchoredPeriod(
      { start: sub.currentPeriodStart!, end: sub.currentPeriodEnd! },
      anchorDay,
    )
    const expired = isSelfServePaidPlan(sub.planId)
    sub = {
      ...sub,
      // 到期沒續費 → 降回免費層（額度隨新一期歸零；狀態回 active,不用 canceled——
      // canceled 在額度解析裡等同免費層,但語意上「沒續費」不是「解約」）
      planId: expired ? 'free' : sub.planId,
      status: expired ? 'active' : sub.status,
      currentPeriodStart: p.start,
      currentPeriodEnd: p.end,
    }
    if (expired) {
      downgraded = true
      // 降級後 quotaOverride（業務談定的特批額度）不該跟著留在免費層
      delete sub.quotaOverride
    }
    changed = true
  }

  return { sub, changed, downgraded }
}
