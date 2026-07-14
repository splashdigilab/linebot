import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { periodConfigFrom, terminatePeriodMandate } from '~~/server/utils/newebpay-period'
import { getWorkspaceSubscription, invalidateWorkspaceSubscriptionCache } from '~~/server/utils/billing'

/**
 * POST /api/payment/cancel-subscription
 * body: { workspaceId }
 *
 * 取消自動續訂。**期末生效**——這是訂閱制的標準做法:客戶已經付了這一期的錢,
 * 服務要用到期末,不是按下去就斷。
 *
 * 順序很重要：**先終止藍新的委託，成功了才寫我方資料庫。**
 * 反過來做的話，「我方標記已取消、藍新卻還在扣款」會變成客訴與爭議款。
 *
 * 冪等：terminatePeriodMandate 把「委託本來就已終止（PER10065）」視為成功,
 * 所以「藍新終止成功但我方寫入失敗」時客戶再按一次就會修好——這是關鍵,
 * 否則他會永遠卡在「取消失敗」而卡片繼續被扣。
 *
 * ⚠️ 只要訂閱上還留著 periodNo 就允許取消,不看 autoRenew。因為寬限期滿被降回免費層的
 *    帳號 autoRenew 已經是 false,但藍新那張委託**還活著、還在扣卡**——那正是最需要
 *    停掉它的時刻。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')

  const config = useRuntimeConfig(event)
  const periodCfg = periodConfigFrom(config as unknown as Record<string, unknown>)
  if (!periodCfg) throw createError({ statusCode: 500, statusMessage: '金流尚未設定' })

  const db = getDb()
  const sub = await getWorkspaceSubscription(workspaceId, db)
  // AlterStatus 要 MerOrderNo + PeriodNo 成對；兩者都直接存在訂閱上，不用反查訂單
  if (!sub?.periodNo || !sub.periodOrderNo) {
    throw createError({ statusCode: 400, statusMessage: '此帳號目前沒有自動扣款委託' })
  }

  const t = await terminatePeriodMandate(sub.periodOrderNo, sub.periodNo, periodCfg)
  if (!t.ok) {
    // 藍新沒終止成功 = 卡片還會被扣款。絕不能只在自己這邊標記取消。
    console.error('[payment] 終止委託失敗', workspaceId, sub.periodNo, t.code, t.message)
    throw createError({ statusCode: 502, statusMessage: t.message || '取消訂閱失敗,請聯繫客服' })
  }

  // 期末生效：這一期已付款，服務照用到 currentPeriodEnd。
  // 委託已終止 → 清掉單號（留著只會讓下次取消再打一次藍新）。
  const next = { ...sub, autoRenew: false, cancelAtPeriodEnd: true }
  delete next.periodNo
  delete next.periodOrderNo

  await db.collection('workspaces').doc(workspaceId).update({
    subscription: next,
    updatedAt: FieldValue.serverTimestamp(),
  })
  invalidateWorkspaceSubscriptionCache(workspaceId)

  console.log('[payment] 已取消自動續訂', workspaceId, '本期至', sub.currentPeriodEnd, t.alreadyGone ? '(委託本來就已終止)' : '')
  return { ok: true, activeUntil: sub.currentPeriodEnd }
})
