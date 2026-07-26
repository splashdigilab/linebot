import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { payuniPeriodConfigFrom, terminatePayuniPeriod } from '~~/server/utils/payuni-period'
import { getWorkspaceSubscription, invalidateWorkspaceSubscriptionCache } from '~~/server/utils/billing'

/**
 * POST /api/payment/cancel-subscription
 * body: { workspaceId }
 *
 * 取消 PAYUNi 續期收款自動扣款。**期末生效**——訂閱制標準做法:這一期已付款,服務用到期末,
 * 不是按下去就斷。
 *
 * 順序很重要：**先終止 PAYUNi 的委託（mdfStatus end），成功了才寫我方資料庫。**
 * 反過來做會變成「我方標記已取消、PAYUNi 卻還在扣款」→ 客訴與爭議款。
 *
 * ⚠️ 只要訂閱上還留著 periodNo（=PeriodTradeNo）就允許取消,不看 autoRenew——寬限期滿被降回
 *    免費的帳號 autoRenew 已是 false,但 PAYUNi 那張委託還活著、還在扣卡,那正是最需要停它的時刻。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')

  const config = useRuntimeConfig(event)
  const periodCfg = payuniPeriodConfigFrom(config as unknown as Record<string, unknown>)
  if (!periodCfg) throw createError({ statusCode: 500, statusMessage: '金流尚未設定' })

  const db = getDb()
  const sub = await getWorkspaceSubscription(workspaceId, db)
  if (!sub?.periodNo) {
    throw createError({ statusCode: 400, statusMessage: '此帳號目前沒有自動扣款委託' })
  }

  const t = await terminatePayuniPeriod(sub.periodNo, periodCfg)
  if (!t.ok) {
    // PAYUNi 沒終止成功 = 卡片還會被扣款。絕不能只在自己這邊標記取消。
    console.error('[payment] 終止 PAYUNi 委託失敗', workspaceId, sub.periodNo, t.code, t.message)
    throw createError({ statusCode: 502, statusMessage: t.message || '取消訂閱失敗,請聯繫客服' })
  }

  // 期末生效：這一期已付款,服務照用到 currentPeriodEnd。委託已終止 → 清掉單號。
  const next = { ...sub, autoRenew: false, cancelAtPeriodEnd: true }
  delete next.periodNo
  delete next.periodOrderNo

  await db.collection('workspaces').doc(workspaceId).update({
    subscription: next,
    updatedAt: FieldValue.serverTimestamp(),
  })
  invalidateWorkspaceSubscriptionCache(workspaceId)

  console.log('[payment] 已取消自動續訂', workspaceId, '本期至', sub.currentPeriodEnd)
  return { ok: true, activeUntil: sub.currentPeriodEnd }
})
