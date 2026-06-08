import type { Timestamp, FieldValue } from 'firebase-admin/firestore'

// ═══════════════════════════════════════════════════════════════════
//  Script types
//  Path: scripts/{scriptId}  （top-level + workspaceId 欄位）
//
//  腳本 = 多步驟客服情境。線性流程：trigger → collect → reply
//  簡報 p23 提到的四種節點：觸發 / 收集 / API / 回覆
//  Phase 3 不含 API 節點（屬 Phase 5 即時資料工具）
// ═══════════════════════════════════════════════════════════════════

export type ScriptNodeType = 'trigger' | 'collect' | 'reply'

export interface ScriptTriggerNode {
  id: string
  type: 'trigger'
  /** 任一關鍵字命中就觸發 */
  keywords: string[]
  /** 1–100，越大越優先；多腳本同時命中時取最高 */
  priority: number
  /** 下一個節點 id；空字串視為直接結束 */
  next: string
}

export interface ScriptCollectNode {
  id: string
  type: 'collect'
  /** 問使用者的問題（例：請輸入您的訂單編號） */
  question: string
  /** 收到的值要存到 collected[fieldName]，後面 reply 可用 {{fieldName}} 取用 */
  fieldName: string
  /** 等待使用者輸入的逾時毫秒；超過後 activeScript 失效 */
  expireMs: number
  next: string
}

export interface ScriptReplyNode {
  id: string
  type: 'reply'
  /** 回覆文字；可用 {{fieldName}} 與 {{屬性名}} 變數 */
  text: string
  /** 回覆完是否轉真人（live_agent） */
  thenHandoff: boolean
}

export type ScriptNode = ScriptTriggerNode | ScriptCollectNode | ScriptReplyNode

export interface ScriptDoc {
  workspaceId: string
  name: string
  enabled: boolean
  /** 多腳本同時命中時的優先序：由 trigger.priority 決定，這欄為快取方便 list 排序 */
  priority: number
  nodes: ScriptNode[]
  /** 起始節點 id（必為 trigger 節點） */
  rootNodeId: string
  createdAt: Timestamp | FieldValue
  updatedAt: Timestamp | FieldValue
}

// ═══════════════════════════════════════════════════════════════════
//  User active script state（會掛在 UserDoc.activeScript）
// ═══════════════════════════════════════════════════════════════════

export interface ActiveScriptState {
  scriptId: string
  currentNodeId: string
  collected: Record<string, string>
  startedAt: number
  /** epoch ms；超過此時間下一則訊息進來會直接重置（避免使用者放著不回，下次入店被中斷流程攔截） */
  expiresAt: number
}

// ═══════════════════════════════════════════════════════════════════
//  Defaults & validators
// ═══════════════════════════════════════════════════════════════════

export const DEFAULT_SCRIPT_PRIORITY = 50
export const DEFAULT_COLLECT_EXPIRE_MS = 10 * 60 * 1000 // 10 分鐘沒回就放棄
export const MAX_SCRIPT_NODES = 20

export function validateScriptDoc(doc: Pick<ScriptDoc, 'name' | 'nodes' | 'rootNodeId'>): string | null {
  if (!String(doc.name || '').trim()) return '請輸入腳本名稱'
  if (!Array.isArray(doc.nodes) || doc.nodes.length === 0) return '請至少新增一個節點'
  if (doc.nodes.length > MAX_SCRIPT_NODES) return `節點數超過上限 ${MAX_SCRIPT_NODES}`

  const ids = new Set<string>()
  for (const n of doc.nodes) {
    if (!n.id) return '節點 id 不能為空'
    if (ids.has(n.id)) return `節點 id 重複：${n.id}`
    ids.add(n.id)
  }

  if (!doc.rootNodeId || !ids.has(doc.rootNodeId)) return '請指定起始節點'
  const root = doc.nodes.find(n => n.id === doc.rootNodeId)
  if (!root || root.type !== 'trigger') return '起始節點必須是「觸發」類型'

  // trigger 節點只能有一個（本期不支援多入口）
  const triggerCount = doc.nodes.filter(n => n.type === 'trigger').length
  if (triggerCount !== 1) return '腳本必須有且僅有一個觸發節點'

  // 必須以 reply 結尾
  const hasReply = doc.nodes.some(n => n.type === 'reply')
  if (!hasReply) return '腳本至少要有一個回覆節點'

  // collect 與 trigger 的 next 必須指到存在的節點
  for (const n of doc.nodes) {
    if (n.type === 'reply') continue
    if (!n.next || !ids.has(n.next)) return `節點「${nodeLabelOf(n)}」未指定下一步`
  }

  // trigger 的關鍵字
  if ((root as ScriptTriggerNode).keywords.filter(k => k.trim()).length === 0) {
    return '請為觸發節點設定至少一個關鍵字'
  }

  return null
}

function nodeLabelOf(node: ScriptNode): string {
  if (node.type === 'trigger') return '觸發'
  if (node.type === 'collect') return `收集 ${node.fieldName || ''}`.trim()
  return '回覆'
}

// ═══════════════════════════════════════════════════════════════════
//  Template rendering（簡報 p15 的勾選式動作之外，這裡是 Phase 3 變數機制）
//  {{fieldName}} 從 collected 取；不存在會被原樣留下避免誤刪
// ═══════════════════════════════════════════════════════════════════

export function renderScriptTemplate(
  template: string,
  ctx: { collected?: Record<string, string>; attributes?: Record<string, string> } = {},
): string {
  if (!template) return ''
  return String(template).replace(/\{\{\s*([\w一-龥]+)\s*\}\}/g, (_, key) => {
    const c = ctx.collected?.[key]
    if (c != null && c !== '') return c
    const a = ctx.attributes?.[key]
    if (a != null && a !== '') return a
    return `{{${key}}}` // 找不到值就留原字串方便排查
  })
}

// ═══════════════════════════════════════════════════════════════════
//  Trigger matching
// ═══════════════════════════════════════════════════════════════════

/**
 * 判斷使用者輸入是否觸發某腳本。任一關鍵字以子字串匹配（不分大小寫）即觸發。
 * 多個腳本同時命中時，由 caller 依 priority 排序選取。
 */
export function matchesScriptTrigger(script: Pick<ScriptDoc, 'nodes' | 'rootNodeId' | 'enabled'>, inputText: string): boolean {
  if (!script.enabled) return false
  const text = String(inputText || '').trim().toLowerCase()
  if (!text) return false
  const root = script.nodes.find(n => n.id === script.rootNodeId)
  if (!root || root.type !== 'trigger') return false
  const keywords = root.keywords.map(k => String(k).trim().toLowerCase()).filter(Boolean)
  return keywords.some(k => text.includes(k))
}
