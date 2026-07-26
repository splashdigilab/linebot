import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { PAYUNI_PERIOD_EXCHANGE_ENDPOINTS, buildUppForm, resolvePayuniEnv } from '~~/server/utils/payuni'
import { getWorkspaceSubscription } from '~~/server/utils/billing'
import { getDb } from '~~/server/utils/firebase'

/**
 * POST /api/payment/update-card
 * body: { workspaceId }
 *
 * 「更新信用卡」——把既有的續期委託（PeriodTradeNo）綁到一張新卡。卡片過期／額度不足導致
 * 續扣失敗（past_due）時的**自助補救**：客戶不用「取消再重訂」（那會重跑 3D、週期重錨定），
 * 只要換一張卡，原委託與週期照舊。
 *
 * 流程同 period/Page：回傳表單前端自動 POST → PAYUNi 卡號修改頁收新卡 → 導回 ReturnURL。
 *
 * ⚠️ **內層 encryptInfo 欄位待「續期收款卡號修改」文件最終確認**（PeriodTradeNo 綁定用 / 是否需
 *    另帶單號 / Notify 格式）。已比照 period/Page 帶 Timestamp（少了會被退，剛在建委託踩過）。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')

  const config = useRuntimeConfig(event)
  const merchantId = String(config.payuniMerchantId || '').trim()
  const base = String(config.appBaseUrl || '').trim().replace(/\/$/, '')
  if (!merchantId || !config.payuniHashKey || !config.payuniHashIV) {
    throw createError({ statusCode: 500, statusMessage: '金流尚未設定' })
  }
  if (!config.payuniPeriodEnabled) {
    throw createError({ statusCode: 400, statusMessage: '自動續訂尚未開通' })
  }
  if (!base) {
    throw createError({ statusCode: 500, statusMessage: '未設定對外網址(PUBLIC_BASE_URL)' })
  }

  const db = getDb()
  const sub = await getWorkspaceSubscription(workspaceId, db)
  if (!sub?.periodNo) {
    throw createError({ statusCode: 400, statusMessage: '此帳號目前沒有自動扣款委託,無需更新信用卡' })
  }

  const keys = { merKey: String(config.payuniHashKey), merIV: String(config.payuniHashIV) }
  const encryptInfo: Record<string, string | number> = {
    MerID: merchantId,
    // 要換卡的既有委託。取消/查詢/換卡都用 PeriodTradeNo。
    PeriodTradeNo: sub.periodNo,
    // PAYUNi 必填（與 UPP／period 同一套）——少了它會被退。
    Timestamp: Math.floor(Date.now() / 1000),
    API3D: 1, // 換卡需 3D 驗證新卡
    Cardholder: 1, // 3D 需收持卡人英文名
    NotifyURL: `${base}/payuni/period-notify`,
    ReturnURL: `${base}/payuni/return?ws=${encodeURIComponent(workspaceId)}&card=1`,
  }

  const env = resolvePayuniEnv(config.payuniEnv)
  const fields = buildUppForm(encryptInfo, keys)

  return {
    action: PAYUNI_PERIOD_EXCHANGE_ENDPOINTS[env],
    method: 'POST',
    fields,
  }
})
