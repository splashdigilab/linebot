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

import { addDays, anchoredPeriod, dayOfDate, nextAnchoredPeriod, normalizeAnchorDay } from '../time'
import { isSelfServePaidPlan, type BillingPlanId, type WorkspaceSubscription } from './plans'

/** 休眠帳號的推進上限（50 年）；純防呆,正常永遠碰不到。 */
const MAX_ROLL_ITERATIONS = 600

/**
 * 自動續訂的寬限天數。
 *
 * 藍新定期定額是在**錨定日當天**才發動扣款,通知（NPA-N050）可能晚幾小時才進來。
 * 若「本期一結束就降級」,客戶每個月都會斷線一段時間。所以自動續訂的訂閱到期後
 * 先滾進新一期並標記 past_due（**額度照給、服務照跑**）,等扣款通知把它改回 active。
 *
 * 通知遲遲不來（扣款失敗、卡片過期、藍新委託被終止）→ 寬限期滿才真的降回免費層。
 * 這也是之後接「扣款失敗自動重試（dunning）」的落腳處:重試都在這幾天內發生。
 */
export const GRACE_DAYS = 3

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
 * 做四件事：
 *   ① 補完週期（舊資料 / super admin 手動開通可能只有半套）
 *   ② 一期一期往前滾,直到 today 落在本期內 → 這就是「額度重置」
 *   ③ 自助付費方案滾過到期日,依「有沒有自動續訂」分兩條路：
 *        · **有自動續訂** → 進 past_due 寬限期（額度照給,等藍新扣款通知把它改回 active）
 *        · **沒有 / 已按取消** → 直接降回免費層
 *   ④ 寬限期用完仍未收到扣款成功通知 → 才真的降回免費層
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

  // ② + ③ 滾到包含今天的那一期
  let guard = 0
  while (sub.currentPeriodEnd! < today && guard++ < MAX_ROLL_ITERATIONS) {
    const p = nextAnchoredPeriod(
      { start: sub.currentPeriodStart!, end: sub.currentPeriodEnd! },
      anchorDay,
    )
    sub = { ...sub, currentPeriodStart: p.start, currentPeriodEnd: p.end }
    changed = true

    if (!isSelfServePaidPlan(sub.planId)) continue // 免費 / 企業 / 內部：純續期

    if (sub.autoRenew && !sub.cancelAtPeriodEnd) {
      // 有自動續訂 → 先進寬限期,額度照給,等藍新的扣款通知把它改回 active
      sub = { ...sub, status: 'past_due' }
    }
    else {
      sub = downgradeToFree(sub)
      downgraded = true
    }
  }

  // ④ 寬限期用完仍是 past_due（扣款失敗 / 通知沒來）→ 真的降回免費層
  if (
    sub.status === 'past_due'
    && isSelfServePaidPlan(sub.planId)
    && addDays(sub.currentPeriodStart!, GRACE_DAYS) < today
  ) {
    sub = downgradeToFree(sub)
    downgraded = true
    changed = true
  }

  // ⑤ past_due 只對「付費方案」有意義（它代表「等扣款,先讓你繼續用」）。
  //    若方案已經是免費層還掛著 past_due,上面的寬限期邏輯完全管不到它 → 狀態會永遠卡住,
  //    帳單頁一直顯示紅色的「扣款未成功」而且取消入口被那個分支蓋掉。這裡把它清乾淨。
  if (sub.status === 'past_due' && !isSelfServePaidPlan(sub.planId)) {
    sub = { ...sub, status: 'active' }
    changed = true
  }

  return { sub, changed, downgraded }
}

/**
 * 降回免費層。狀態設 active 而非 canceled——「沒續費」不是「解約」,
 * 而且 canceled 在額度解析裡本來就等同免費層,多一個狀態只是多一個要照顧的分支。
 *
 * ⚠️ **委託單號（periodNo / periodOrderNo）刻意保留。**
 *    降級只是「我方不再給付費方案」,藍新那張委託**仍然是活的、仍然會扣客戶的卡**。
 *    把單號刪掉 = 我方再也認不得那張委託 → 取消 API 找不到它 → 客戶變成
 *    「服務被降級、卡卻繼續被扣、而且誰都停不掉」。單號留著,取消入口才停得掉它,
 *    對帳排程也才有辦法主動去終止（見 payment.ts runPaymentReconcile）。
 *
 * 特批額度（quotaOverride）則不該跟著留在免費層,清掉。
 */
function downgradeToFree(sub: WorkspaceSubscription): WorkspaceSubscription {
  const next: WorkspaceSubscription = {
    ...sub,
    planId: 'free',
    status: 'active',
    autoRenew: false,
    cancelAtPeriodEnd: false,
  }
  delete next.quotaOverride
  return next
}

/**
 * 收到藍新「本期扣款成功」通知 → 把訂閱確認在當期、回到 active。
 *
 * 通知會在錨定日當天進來,而那時 roll 可能已經把訂閱推進新一期並標成 past_due
 * （寬限期）。這裡先推進到當期拿到正確的本期起訖,再把方案與狀態蓋回去。
 *
 * ⚠️ 方案**必須由呼叫端從訂單傳進來**,不能沿用 roll 之後的 sub.planId——通知若遲到
 *    超過寬限期,roll 早就把方案降成免費層了,直接沿用會變成「免費方案 active」,
 *    客戶付了錢卻只拿到 200 則。傳 planId 進來等於「錢收到了,把方案復原」。
 */
export function confirmRenewal(
  input: WorkspaceSubscription,
  today: string,
  paid: { planId: BillingPlanId; periodNo?: string | null; periodOrderNo?: string | null },
): WorkspaceSubscription {
  // 客戶已經按過取消 → 這筆多半是「終止委託」與藍新當期扣款的競態（錢已經扣了）。
  // 該給的一期照給,但**絕不能把 autoRenew 打開**——那等於系統自己把客戶的取消撤銷掉,
  // 帳單頁還會顯示一個永遠不會發生的「下次扣款日」。
  const wasCanceled = input.cancelAtPeriodEnd === true

  const { sub } = rollSubscriptionToCurrentPeriod(input, today)
  const next: WorkspaceSubscription = {
    ...sub,
    planId: paid.planId,
    status: 'active',
    autoRenew: !wasCanceled,
    cancelAtPeriodEnd: wasCanceled,
  }
  // 委託單號要一起帶回：續期成功代表這張委託還活著,之後客戶要取消得靠它
  // （AlterStatus 需要 MerOrderNo + PeriodNo 成對）。
  if (!wasCanceled) {
    if (paid.periodNo) next.periodNo = paid.periodNo
    if (paid.periodOrderNo) next.periodOrderNo = paid.periodOrderNo
  }
  return next
}
