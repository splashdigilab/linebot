import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { BILLING_PLAN_ORDER, getBillingPlan } from '~~/shared/billing/plans'
import type { BillingPlanId } from '~~/shared/billing/plans'
import { buildTradeInfo, makeTradeSha } from '~~/server/utils/newebpay'
import { createPendingOrder, findRecentPendingOrder, newMerchantOrderNo } from '~~/server/utils/payment'
import type { WorkspaceDoc } from '~~/shared/types/organization'

/**
 * POST /api/payment/create-order
 * body: { workspaceId, planId }
 *
 * 建立一筆 pending 訂單,回傳藍新 MPG 自動送出表單所需欄位。
 * 金額由後端依方案表決定(不信前端傳值);免費 / 客製方案不支援線上結帳。
 * 需 admin(帳號管理員 / 組織管理員 / super admin)。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId, uid, token } = await requireWorkspaceAccess(event, 'admin')
  const body = await readBody(event)
  const planId = String(body?.planId || '') as BillingPlanId

  if (!BILLING_PLAN_ORDER.includes(planId)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid planId' })
  }
  const plan = getBillingPlan(planId)
  if (plan.custom || plan.priceMonthly == null || plan.priceMonthly <= 0) {
    throw createError({ statusCode: 400, statusMessage: '此方案不支援線上結帳,請聯繫業務' })
  }

  const config = useRuntimeConfig(event)
  const merchantId = String(config.newebpayMerchantId || '').trim()
  const base = String(config.appBaseUrl || '').trim().replace(/\/$/, '')
  if (!merchantId || !config.newebpayHashKey || !config.newebpayHashIV) {
    throw createError({ statusCode: 500, statusMessage: '金流尚未設定' })
  }
  if (!base) {
    throw createError({ statusCode: 500, statusMessage: '未設定對外網址(PUBLIC_BASE_URL)' })
  }

  const db = getDb()
  const wsSnap = await db.collection('workspaces').doc(workspaceId).get()
  if (!wsSnap.exists) throw createError({ statusCode: 404, statusMessage: '找不到此官方帳號' })
  const organizationId = (wsSnap.data() as WorkspaceDoc).organizationId ?? null

  // 去重:同帳號同方案近 30 分鐘內已有 pending 訂單 → 沿用同一單號(藍新端亦擋重複付款),
  // 避免連點兩下 / 雙分頁重複扣款。
  const existing = await findRecentPendingOrder(workspaceId, planId, new Date(), db)
  const amount = existing?.amount ?? plan.priceMonthly
  const merchantOrderNo = existing?.merchantOrderNo ?? newMerchantOrderNo(new Date())
  if (!existing) {
    await createPendingOrder({ merchantOrderNo, workspaceId, organizationId, planId, amount, createdBy: uid }, db)
  }

  const keys = { hashKey: String(config.newebpayHashKey), hashIV: String(config.newebpayHashIV) }
  const params: Record<string, string | number> = {
    MerchantID: merchantId,
    RespondType: 'JSON',
    TimeStamp: Math.floor(Date.now() / 1000),
    Version: '2.0',
    MerchantOrderNo: merchantOrderNo,
    Amt: amount,
    ItemDesc: `${plan.name}方案(1 個月)`,
    NotifyURL: `${base}/newebpay/notify`,
    ReturnURL: `${base}/newebpay/return?ws=${encodeURIComponent(workspaceId)}&no=${merchantOrderNo}`,
  }
  const email = String(token.email || '').trim()
  if (email) params.Email = email

  const tradeInfo = buildTradeInfo(params, keys)
  const tradeSha = makeTradeSha(tradeInfo, keys)

  // 前端據此建 hidden form 自動 POST 到 action
  return {
    merchantOrderNo,
    action: String(config.newebpayApiUrl || '').trim(),
    method: 'POST',
    fields: { MerchantID: merchantId, TradeInfo: tradeInfo, TradeSha: tradeSha, Version: '2.0' },
  }
})
