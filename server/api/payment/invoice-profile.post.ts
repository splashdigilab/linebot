import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { isValidCarrierNum, isValidLoveCode, isValidUBN } from '~~/server/utils/ezpay-invoice'
import type { InvoiceProfile } from '~~/shared/types/organization'

/**
 * POST /api/payment/invoice-profile — 儲存發票開立資訊（統編／抬頭／載具／捐贈碼）。
 *
 * 在這裡把格式擋掉，而不是等 ezPay 退件——發票是在「付款成功之後」才開的，
 * 那時候客戶已經離開頁面了，退件他不會知道，只會過幾天發現沒收到發票。
 *
 * 載具與捐贈碼互斥（ezPay 硬性規定）；有統編就是 B2B，載具/捐贈碼一律不適用。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const body = await readBody(event)

  const ubn = String(body?.buyerUBN || '').trim()
  const buyerName = String(body?.buyerName || '').trim()
  const buyerEmail = String(body?.buyerEmail || '').trim()
  const carrierNum = String(body?.carrierNum || '').trim().toUpperCase()
  const loveCode = String(body?.loveCode || '').trim()

  if (ubn && !isValidUBN(ubn)) {
    throw createError({ statusCode: 400, statusMessage: '統一編號需為 8 碼數字' })
  }
  if (buyerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    throw createError({ statusCode: 400, statusMessage: 'Email 格式不正確' })
  }

  const profile: InvoiceProfile = {
    buyerUBN: ubn || null,
    buyerName: buyerName || null,
    buyerEmail: buyerEmail || null,
    carrierNum: null,
    loveCode: null,
  }

  if (ubn) {
    // B2B：公司報帳一律開可列印的發票，載具／捐贈碼不適用（帶了 ezPay 也會退）
    if (!buyerName) {
      throw createError({ statusCode: 400, statusMessage: '有統一編號時必須填公司抬頭' })
    }
  }
  else {
    if (carrierNum && loveCode) {
      throw createError({ statusCode: 400, statusMessage: '載具與捐贈碼只能擇一' })
    }
    if (carrierNum && !isValidCarrierNum(carrierNum)) {
      throw createError({ statusCode: 400, statusMessage: '手機條碼載具格式錯誤（斜線 + 7 碼大寫英數）' })
    }
    if (loveCode && !isValidLoveCode(loveCode)) {
      throw createError({ statusCode: 400, statusMessage: '捐贈碼需為 3–7 碼數字' })
    }
    profile.carrierNum = carrierNum || null
    profile.loveCode = loveCode || null
  }

  await getDb().collection('workspaces').doc(workspaceId).update({
    invoiceProfile: profile,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { ok: true, profile }
})
