import type { Timestamp, FieldValue } from 'firebase-admin/firestore'

// ═══════════════════════════════════════════════════════════════════
//  Collection: demoLeads
//  Doc ID: uuid
//
//  「潛在客戶名單」——由公開落地頁的「預約 Demo」表單、以及無權限帳號的
//  迎賓頁「加入候補名單」寫入。與 leadCampaigns / leadClaims（LINE LIFF 的
//  加好友貼標名單）是**完全不同的概念**：那是租戶用來收自己客人的工具，
//  這是我們自己收「想用這套系統的店家」的業務名單。
//
//  server-only（firestore.rules deny-all）；由公開端點 /api/leads 寫入，
//  只有 super admin 看得到（/admin/super/leads）。
// ═══════════════════════════════════════════════════════════════════

/** 名單來源頁。 */
export type DemoLeadSource = 'landing_demo' | 'welcome_waitlist' | 'other'

/** 名單處理狀態（業務跟進用）。 */
export type DemoLeadStatus = 'new' | 'contacted' | 'converted' | 'archived'

export const DEMO_LEAD_STATUSES: DemoLeadStatus[] = ['new', 'contacted', 'converted', 'archived']

export interface DemoLeadDoc {
  /** 稱呼（選填） */
  name: string
  /** 聯絡方式：Email 或 LINE ID（必填） */
  contact: string
  /** 產業別（選填，落地頁下拉） */
  industry: string
  /** 最想先解決的問題（選填，落地頁下拉） */
  need: string
  /** 對哪個方案有興趣（選填，從定價卡 CTA 帶入的 planId） */
  interestedPlanId: string | null
  /** 來源頁 */
  source: DemoLeadSource
  /** 處理狀態 */
  status: DemoLeadStatus
  /** 送出時的 User-Agent（協助辨識灌水） */
  userAgent: string | null
  /** 內部備註（業務跟進） */
  note: string | null
  createdAt: Timestamp | FieldValue
  updatedAt: Timestamp | FieldValue
}
