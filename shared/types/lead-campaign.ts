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
 * expired  – token 逾期，不可再使用
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
  expiresAt: Timestamp | Date
  claimedAt: Timestamp | FieldValue | null
  appliedAt: Timestamp | FieldValue | null
  createdAt: Timestamp | FieldValue
}
