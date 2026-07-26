import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { BILLING_PLAN_ORDER, getBillingPlan } from '~~/shared/billing/plans'
import type { BillingPlanId } from '~~/shared/billing/plans'
import { PAYUNI_PERIOD_ENDPOINTS, buildUppForm, resolvePayuniEnv } from '~~/server/utils/payuni'
import { createPendingOrder, findRecentPendingOrder, newMerchantOrderNo } from '~~/server/utils/payment'
import { getWorkspaceSubscription } from '~~/server/utils/billing'
import { dayOfDate, taipeiDate } from '~~/shared/time'
import type { WorkspaceDoc } from '~~/shared/types/organization'

/**
 * POST /api/payment/create-subscription
 * body: { workspaceId, planId }
 *
 * 建立 PAYUNi「續期收款」信用卡約定扣款委託 —— 客戶刷一次卡，之後每月由 PAYUNi 自動扣款。
 * 回傳前端要自動 POST 到 PAYUNi 續期支付頁（/api/period/Page）的表單欄位（與 UPP 同一套加密）。
 *
 * · `PeriodType=month` + `PeriodDate=錨定日`（今天幾號）→ 每月同一天扣款,與 shared/time.ts 的
 *   anchoredPeriod 對齊（PAYUNi 對短月沒有的日期會用該月最後一天,兩邊續期日永遠對得起來）。
 * · `FType=build`：委託建立當日就扣一期全額 → 客戶當場拿到完整一期（錨定日制,首期不折算天數）。
 * · `API3D=1`：僅首次強制 3D,之後每期自動扣款無 3D（token 化）。
 *
 * 換方案時**不在這裡終止舊委託**——建單只是產一張要送 PAYUNi 的表單,客戶可能放棄;等新委託
 * 首期扣款成功（period-notify）後才終止舊委託,放棄付款的客戶保住原訂閱。
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
  const merchantId = String(config.payuniMerchantId || '').trim()
  const base = String(config.appBaseUrl || '').trim().replace(/\/$/, '')
  if (!merchantId || !config.payuniHashKey || !config.payuniHashIV) {
    throw createError({ statusCode: 500, statusMessage: '金流尚未設定' })
  }
  if (!config.payuniPeriodEnabled) {
    throw createError({ statusCode: 400, statusMessage: '自動續訂尚未開通,請改用單次付款' })
  }
  if (!base) {
    throw createError({ statusCode: 500, statusMessage: '未設定對外網址(PUBLIC_BASE_URL)' })
  }

  const db = getDb()
  const wsSnap = await db.collection('workspaces').doc(workspaceId).get()
  if (!wsSnap.exists) throw createError({ statusCode: 404, statusMessage: '找不到此官方帳號' })
  const organizationId = (wsSnap.data() as WorkspaceDoc).organizationId ?? null

  // 換方案：記下舊委託,等新委託首期扣款成功後才終止（見 period-notify）。
  const currentSub = await getWorkspaceSubscription(workspaceId, db)
  const supersedesPeriodNo = currentSub?.periodNo ?? null
  const supersedesPeriodOrderNo = currentSub?.periodOrderNo ?? null

  const now = new Date()
  // 每月扣款日 = 今天幾號 = 訂閱錨定日。**跟著訂單存下**,開通時沿用不重算（跨午夜差一天會害後續降級）。
  const anchorDay = dayOfDate(taipeiDate(now))

  // 去重：同帳號同方案近 30 分鐘內的 pending 單沿用同一單號，避免連點建出兩張委託。
  const existing = await findRecentPendingOrder(workspaceId, planId, now, db)
  const amount = existing?.amount ?? plan.priceMonthly
  const merchantOrderNo = existing?.merchantOrderNo ?? newMerchantOrderNo(now)
  if (!existing) {
    await createPendingOrder(
      {
        merchantOrderNo, workspaceId, organizationId, planId, amount,
        createdBy: uid, kind: 'period_first', anchorDay,
        supersedesPeriodNo, supersedesPeriodOrderNo,
      },
      db,
    )
  }

  const keys = { merKey: String(config.payuniHashKey), merIV: String(config.payuniHashIV) }
  const encryptInfo: Record<string, string | number> = {
    MerID: merchantId,
    MerTradeNo: merchantOrderNo,
    // ⚠️ PAYUNi 必填（與 UPP 同一套）——少了它委託建單會被退。與單次付款 create-order 一致。
    Timestamp: Math.floor(now.getTime() / 1000),
    PeriodAmt: amount,
    ProdDesc: `${plan.name}方案 每月自動續訂`,
    PeriodType: 'month', // 每月
    // 每月扣款日；補零成兩碼（01–31），與 shared/time.ts 錨定日對齊（當月無該日 PAYUNi 用月底）
    PeriodDate: String(existing?.anchorDay ?? anchorDay).padStart(2, '0'),
    PeriodTimes: 99, // 執行扣款次數上限；到期前客戶早就取消或換方案
    FType: 'build', // 委託建立當日就首扣一期 → 立即開通
    API3D: 1, // 首次強制 3D；後續續期無 3D
    Cardholder: 1, // 3D 需付款頁收持卡人英文名供發卡行驗證
    NotifyURL: `${base}/payuni/period-notify`,
    ReturnURL: `${base}/payuni/return?ws=${encodeURIComponent(workspaceId)}&no=${merchantOrderNo}`,
  }
  // PAYUNi 消費者信箱欄位是 UsrMail（非藍新的 PayerEmail）——付款頁據此帶入信箱
  const email = String(token.email || '').trim()
  if (email) encryptInfo.UsrMail = email

  const env = resolvePayuniEnv(config.payuniEnv)
  const fields = buildUppForm(encryptInfo, keys)

  return {
    merchantOrderNo,
    action: PAYUNI_PERIOD_ENDPOINTS[env],
    method: 'POST',
    fields,
  }
})
