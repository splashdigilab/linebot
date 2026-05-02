import type { Timestamp, FieldValue } from 'firebase-admin/firestore'
import type { ModuleType } from './conversation-stats'
import type { AutoReplyAction, AutoReplyMatchType, AutoReplyTagging } from '../auto-reply-rule'

// ═══════════════════════════════════════════════════════════════════
//  Collection: users
//  Doc ID: `${workspaceId}_${lineUserId}`
// ═══════════════════════════════════════════════════════════════════

export interface UserDoc {
  workspaceId: string
  /** LINE userId */
  lineUserId: string
  displayName: string
  pictureUrl: string
  isBlocked: boolean
  createdAt: Timestamp | FieldValue
}

// ═══════════════════════════════════════════════════════════════════
//  Collection: conversations
//  Doc ID: `${workspaceId}_${lineUserId}`（與 users 同 key，一對一）
// ═══════════════════════════════════════════════════════════════════

export interface ConversationDoc {
  workspaceId: string
  userId: string
  lastMessage: string
  lastDirection: 'incoming' | 'outgoing'
  lastMessageAt: Timestamp | null
}

// ═══════════════════════════════════════════════════════════════════
//  Collection: flows
//  Doc ID: uuid
// ═══════════════════════════════════════════════════════════════════

export interface FlowDoc {
  workspaceId: string
  name: string
  messages: any[]
  isActive: boolean
  moduleType: ModuleType
  /** true = 系統預設模組，不可刪除 */
  isSystem: boolean
  createdAt: Timestamp | FieldValue
}

// ═══════════════════════════════════════════════════════════════════
//  Collection: autoReplies
//  Doc ID: uuid
// ═══════════════════════════════════════════════════════════════════

export interface AutoReplyDoc {
  workspaceId: string
  name: string
  keyword: string
  matchType: AutoReplyMatchType
  action: AutoReplyAction
  /** 對應 action.moduleId 的快取欄位 */
  moduleId: string
  isActive: boolean
  tagging: AutoReplyTagging
  createdAt: Timestamp | FieldValue
}

// ═══════════════════════════════════════════════════════════════════
//  Collection: richMessages
//  Doc ID: uuid
// ═══════════════════════════════════════════════════════════════════

export interface RichMessageDoc {
  workspaceId: string
  name: string
  layoutId: string
  transparentBackground: boolean
  altText: string
  heroImageUrl: string
  actions: any[]
  isActive: boolean
  createdAt: Timestamp | FieldValue
}

// ═══════════════════════════════════════════════════════════════════
//  Collection: supportPresets
//  Doc ID: uuid
// ═══════════════════════════════════════════════════════════════════

export interface SupportPresetDoc {
  workspaceId: string
  name: string
  action: AutoReplyAction
  moduleId: string
  isActive: boolean
  tagging: AutoReplyTagging
  createdAt: Timestamp | FieldValue
}

// ═══════════════════════════════════════════════════════════════════
//  Collection: richmenus
//  Doc ID: uuid
// ═══════════════════════════════════════════════════════════════════

export interface RichMenuDoc {
  workspaceId: string
  name: string
  /** LINE 平台回傳的 richMenuId */
  richMenuId: string
  /** LINE Alias ID（給 LIFF 或 API 指定用） */
  aliasId: string
  size: { width: number; height: number }
  areas: any[]
  chatBarText: string
  imageUrl: string
  isDefault: boolean
  createdAt: Timestamp | FieldValue
}
