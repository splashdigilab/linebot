import type { Timestamp, FieldValue } from 'firebase-admin/firestore'

// ═══════════════════════════════════════════════════════════════════
//  Collection: leadCampaigns
//  Doc ID: uuid
// ═══════════════════════════════════════════════════════════════════

export interface LeadCampaignDoc {
  name: string
  /** 小寫底線格式，例如 launch_2026_q2；用於 CTA URL 的 c= 參數 */
  campaignCode: string
  /** 此活動對應的 LINE LIFF ID，例如 2007123456-AbCdEfGh */
  liffId: string
  /** 使用者加好友後要自動貼的標籤 IDs */
  tagIds: string[]
  /** 加好友後要自動觸發的機器人模組（選填；null = 只貼標） */
  moduleId: string | null
  description: string
  isActive: boolean
  /**
   * 活動檔期（選填，ISO 8601 字串）。僅供後台／行銷紀錄，不影響連結或貼標邏輯。
   */
  startsAt?: string | null
  endsAt?: string | null
  /** 儲存活動後自動產生的活動進入網址（含一次性 ct） */
  publishedCtaUrl?: string | null
  publishedClaimId?: string | null
  createdAt: Timestamp | FieldValue
  updatedAt: Timestamp | FieldValue
}

// ═══════════════════════════════════════════════════════════════════
//  Collection: leadClaims
//  Doc ID: uuid
// ═══════════════════════════════════════════════════════════════════

/**
 * pending  – token 已產出，尚未有使用者進入 LIFF
 * claimed  – 使用者進入 LIFF 並完成 LINE 身份綁定（lineUserId 已填入）
 * applied  – follow 事件觸發，已完成貼標並執行模組
 * expired  – token 已逾期或手動標記，不可再使用（舊資料；新產生的 claim 可不設 expiresAt）
 */
export type LeadClaimStatus = 'pending' | 'claimed' | 'applied' | 'expired'

export interface LeadClaimDoc {
  campaignId: string
  campaignCode: string
  /** SHA-256(rawToken) hex，原始 token 不存 DB */
  tokenHash: string
  /** LIFF 完成後填入的 LINE userId */
  lineUserId: string | null
  status: LeadClaimStatus
  /** 從活動快照複製的 tagIds（claim 生成當下） */
  tagIds: string[]
  /** 從活動快照複製的 moduleId */
  moduleId: string | null
  /** 未設定則不因時間逾期（仍為一次性 token，用過即進入 claimed／applied 流程） */
  expiresAt?: Timestamp | Date | null
  claimedAt: Timestamp | FieldValue | null
  appliedAt: Timestamp | FieldValue | null
  createdAt: Timestamp | FieldValue
}
