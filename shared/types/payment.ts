import type { Timestamp, FieldValue } from 'firebase-admin/firestore'
import type { BillingPlanId } from '../billing/plans'

// ═══════════════════════════════════════════════════════════════════
//  Collection: paymentOrders
//  Doc ID: merchantOrderNo（藍新 MerchantOrderNo，僅英數，<=30 碼）
//
//  一筆付款訂單即一次「開通某方案一期」的請求。建單時寫入 pending，
//  金額／方案以「建單當下後端寫入的值」為準（Notify 回傳只做比對，防竄改）。
//  藍新 Notify（server→server）確認付款成功後由 webhook 改為 paid 並開通訂閱。
// ═══════════════════════════════════════════════════════════════════

export type PaymentOrderStatus = 'pending' | 'paid' | 'failed' | 'expired'

export interface PaymentOrderDoc {
  merchantOrderNo: string
  workspaceId: string
  organizationId?: string | null
  planId: BillingPlanId
  /** 應付金額（TWD 整數）；以建單時後端寫入為準 */
  amount: number
  status: PaymentOrderStatus
  /** 藍新交易序號（Notify 回傳） */
  tradeNo?: string | null
  /** 付款方式（CREDIT / VACC / CVS…；Notify 回傳） */
  paymentType?: string | null
  /** 成功開通的本期起訖（YYYY-MM-DD，與訂閱一致） */
  periodStart?: string | null
  periodEnd?: string | null
  /** 建單者 uid（稽核用） */
  createdBy?: string | null
  createdAt: Timestamp | FieldValue
  paidAt?: Timestamp | FieldValue | null
  updatedAt: Timestamp | FieldValue
  /** Notify 解密後的重點欄位（對帳／稽核用） */
  notifyRaw?: Record<string, unknown> | null
}
