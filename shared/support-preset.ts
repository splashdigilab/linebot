import {
  normalizeAutoReplyAction,
  normalizeAutoReplyTagging,
  type AutoReplyAction,
  type AutoReplyTagging,
} from './auto-reply-rule'

export interface SupportPresetShape {
  id?: string
  name: string
  action: AutoReplyAction
  isActive: boolean
  tagging: AutoReplyTagging
}

export function normalizeSupportPreset(raw: any): SupportPresetShape {
  return {
    id: raw?.id ? String(raw.id) : undefined,
    name: String(raw?.name ?? '').trim(),
    action: normalizeAutoReplyAction(raw?.action, String(raw?.moduleId ?? '')),
    isActive: raw?.isActive !== false,
    tagging: normalizeAutoReplyTagging(raw?.tagging),
  }
}

export function validateSupportPreset(preset: SupportPresetShape): string | null {
  if (!preset.name.trim()) return '請輸入預存名稱'
  if (preset.action.type === 'module' && !preset.action.moduleId) return '請選擇要觸發的機器人模組'
  if (preset.action.type === 'message' && !preset.action.text) return '請輸入回覆文字'
  if (preset.action.type === 'uri' && !preset.action.uri) return '請輸入網址'
  return null
}
