import type { Timestamp, FieldValue } from 'firebase-admin/firestore'
import type { WorkspaceSubscription } from '../billing/plans'

// ═══════════════════════════════════════════════════════════════════
//  Collection: organizations
//  Doc ID: uuid
// ═══════════════════════════════════════════════════════════════════

export type OrganizationPlan = 'free' | 'starter' | 'pro' | 'enterprise'

/** 每個方案允許的最大 workspace 數量；enterprise 為無限制 */
export const PLAN_WORKSPACE_QUOTA: Record<OrganizationPlan, number> = {
  free: 1,
  starter: 3,
  pro: 10,
  enterprise: Infinity,
}

export interface OrganizationDoc {
  name: string
  plan: OrganizationPlan
  /** 登記擁有者 Email（小寫）；與 ownerId 擇一或並存 */
  ownerEmail?: string
  /** Firebase uid；若擁有者尚未註冊則可能缺省 */
  ownerId?: string
  disabled?: boolean
  createdAt: Timestamp | FieldValue
  updatedAt: Timestamp | FieldValue
}

// ═══════════════════════════════════════════════════════════════════
//  Collection: workspaces
//  Doc ID: workspace id (e.g. uuid or "default")
// ═══════════════════════════════════════════════════════════════════

export interface WorkspaceDoc {
  name: string
  channelAccessToken?: string
  channelSecret?: string
  defaultLiffId?: string
  organizationId?: string | null
  /**
   * 計費訂閱（掛在帳號 / OA 層，每個帳號各自一份、額度不共用）。
   * 未設 = 免費層（DEFAULT_BILLING_PLAN_ID）。方案內容見 shared/billing/plans.ts。
   * Phase 1 由 super admin 手動開通寫入；Phase 2 起接金流 webhook 維護。
   */
  subscription?: WorkspaceSubscription
  updatedAt: Timestamp | FieldValue
}

// ═══════════════════════════════════════════════════════════════════
//  Collection: orgMembers
//  Doc ID: `${uid}_${orgId}`
// ═══════════════════════════════════════════════════════════════════

/** 組織層級角色：目前只有 admin */
export type OrgMemberRole = 'admin'

export interface OrgMemberDoc {
  uid: string
  orgId: string
  role: OrgMemberRole
  invitedBy: string | null
  invitedEmail: string | null
  joinedAt: Timestamp | FieldValue
  createdAt: Timestamp | FieldValue
}

// ═══════════════════════════════════════════════════════════════════
//  Collection: workspaceMembers
//  Doc ID: `${uid}_${workspaceId}`
// ═══════════════════════════════════════════════════════════════════

/** 角色權限層級：owner > admin > agent > viewer */
export type WorkspaceMemberRole = 'owner' | 'admin' | 'agent' | 'viewer'

export interface WorkspaceMemberDoc {
  uid: string
  workspaceId: string
  organizationId: string | null
  role: WorkspaceMemberRole
  /** 邀請者的 Firebase uid；owner 自行建立時為 null */
  invitedBy: string | null
  /** 邀請時輸入的 email，供顯示用 */
  invitedEmail: string | null
  joinedAt: Timestamp | FieldValue
  createdAt: Timestamp | FieldValue
}

// ═══════════════════════════════════════════════════════════════════
//  Collection: workspaceInvites
//  Doc ID: auto id — 對方尚無 Firebase 帳號時的 email 邀請（首次登入後轉成 workspaceMembers）
// ═══════════════════════════════════════════════════════════════════

export type WorkspaceInviteRole = 'admin' | 'agent' | 'viewer'

export interface WorkspaceInviteDoc {
  workspaceId: string
  organizationId: string | null
  /** 小寫 email，與 Firebase token.email 比對 */
  email: string
  role: WorkspaceInviteRole
  invitedBy: string
  createdAt: Timestamp | FieldValue
}
