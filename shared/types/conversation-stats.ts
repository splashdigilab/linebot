export type ModuleType = 'welcome' | 'bot_flow' | 'system_notice' | 'live_agent'
export type InitialHandler = 'bot' | 'human' | 'unhandled'
export type ConversationStatus =
  | 'open'
  | 'bot_handling'
  | 'pending_human'
  | 'human_handling'
  | 'closed'
export type ConversationEventType =
  | 'conversation_opened'
  | 'entered_module'
  | 'handoff_request'
  | 'human_first_reply'
  | 'conversation_closed'

export type TrendGranularity = 'day' | 'week' | 'month'

export interface ConversationSessionDoc {
  workspaceId: string
  userId: string
  openedAt: FirebaseFirestore.Timestamp
  closedAt: FirebaseFirestore.Timestamp | null
  lastActivityAt: FirebaseFirestore.Timestamp
  status: ConversationStatus
  initialHandler: InitialHandler
  currentHandler: InitialHandler
  initialModuleType: ModuleType | null
  currentModuleType: ModuleType | null
  hasHandoff: boolean
  handoffRequestedAt: FirebaseFirestore.Timestamp | null
  humanFirstRepliedAt: FirebaseFirestore.Timestamp | null
}

export interface ConversationEventDoc {
  workspaceId: string
  sessionId: string
  userId: string
  eventType: ConversationEventType
  moduleType?: ModuleType
  moduleId?: string
  timestamp: FirebaseFirestore.Timestamp
}

export interface KpiResult {
  total: number
  botHandled: number
  humanHandled: number
  unhandled: number
  handoffCount: number
  handoffRate: number
  closedCount: number
  handledCount: number
  closeRateByTotal: number
  closeRateByHandled: number
}

export interface TrendBucket {
  date: string
  total: number
  bot: number
  human: number
  unhandled: number
  handoff: number
  closed: number
}

export const SYSTEM_MODULE_IDS = {
  welcome: 'sys_welcome',
  live_agent: 'sys_live_agent',
} as const

/** 工作區自行建立的流程可用類型（歡迎／真人僅限系統預設兩筆） */
export const WORKSPACE_FLOW_MODULE_TYPES: readonly ModuleType[] = ['bot_flow', 'system_notice']

export const MODULE_TYPE_LABELS: Record<ModuleType, string> = {
  welcome: '歡迎模組',
  bot_flow: '機器人流程',
  system_notice: '系統通知',
  live_agent: '真人客服',
}

export const STATUS_LABELS: Record<ConversationStatus, string> = {
  open: '待處理',
  bot_handling: '機器人處理中',
  pending_human: '待真人',
  human_handling: '真人處理中',
  closed: '已結束',
}

export const INITIAL_HANDLER_LABELS: Record<InitialHandler, string> = {
  bot: '機器人首接',
  human: '真人首接',
  unhandled: '未首接',
}

export const SESSION_24H_MS = 24 * 60 * 60 * 1000
