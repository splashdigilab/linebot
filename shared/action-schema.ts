export const MAX_ACTION_SLOTS = 6
export const SLOT_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'] as const
export type SlotLabel = typeof SLOT_LABELS[number]

export type UnifiedActionType = 'uri' | 'message' | 'module'

export interface UnifiedAction {
  slot: string
  type: UnifiedActionType
  uri: string
  text: string
  moduleId: string
}

export const TRIGGER_MODULE_PREFIX = 'triggerModule='

export function encodeTriggerModule(moduleId: string): string {
  return `${TRIGGER_MODULE_PREFIX}${String(moduleId || '').trim()}`
}

export function decodeTriggerModule(data: string): string {
  if (typeof data !== 'string') return ''
  if (!data.startsWith(TRIGGER_MODULE_PREFIX)) return ''
  return data.slice(TRIGGER_MODULE_PREFIX.length).trim()
}

export function normalizeUnifiedAction(input: any, fallbackSlot = 'A'): UnifiedAction {
  const rawType = input?.type
  const type: UnifiedActionType = rawType === 'message' || rawType === 'module' ? rawType : 'uri'
  return {
    slot: String(input?.slot || fallbackSlot),
    type,
    uri: String(input?.uri || ''),
    text: String(input?.text || ''),
    moduleId: String(input?.moduleId || ''),
  }
}

export function normalizeUnifiedActions(actions: any[]): UnifiedAction[] {
  const list = Array.isArray(actions) ? actions.slice(0, MAX_ACTION_SLOTS) : []
  return list.map((action, index) => normalizeUnifiedAction(action, SLOT_LABELS[index] || `S${index + 1}`))
}

export function validateUnifiedAction(action: UnifiedAction): string | null {
  if (action.type === 'uri' && !action.uri.trim()) return '請輸入網址'
  if (action.type === 'message' && !action.text.trim()) return '請輸入傳送文字'
  if (action.type === 'module' && !action.moduleId.trim()) return '請選擇觸發模組'
  return null
}
