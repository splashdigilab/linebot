import type { Timestamp, FieldValue } from 'firebase-admin/firestore'

// ═══════════════════════════════════════════════════════════════════
//  Collection: organizations
//  Doc ID: uuid
// ═══════════════════════════════════════════════════════════════════

export type OrganizationPlan = 'free' | 'starter' | 'pro' | 'enterprise'

export interface OrganizationDoc {
  name: string
  plan: OrganizationPlan
  /** Firebase uid of the organization owner */
  ownerId: string
  createdAt: Timestamp | FieldValue
  updatedAt: Timestamp | FieldValue
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
