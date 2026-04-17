import type { UnifiedAction } from './action-schema'
import {
  decodeTriggerModule,
  encodeTriggerModule,
  normalizeUnifiedAction,
} from './action-schema'

/**
 * 將 Firestore / 舊版推播的 messages 還原為統一動作編輯器狀態。
 * 多則訊息時只取第一則可辨識的內容。
 */
export function parseLineMessagesToUnifiedAction(raw: unknown[] | null | undefined): UnifiedAction {
  const empty = normalizeUnifiedAction({ type: 'message', text: '' }, 'A')
  if (!Array.isArray(raw) || !raw.length) return empty

  const first = raw[0] as Record<string, unknown>
  if (!first || typeof first !== 'object') return empty

  if (first.type === 'template' && (first.template as Record<string, unknown>)?.type === 'buttons') {
    const tpl = first.template as { text?: string; actions?: Record<string, unknown>[] }
    const actions = Array.isArray(tpl.actions) ? tpl.actions : []
    const bodyText = String(tpl.text || '')
    if (actions.length >= 1) {
      const a0 = actions[0]
      if (a0?.type === 'uri' && typeof a0.uri === 'string' && a0.uri.trim()) {
        return normalizeUnifiedAction(
          { type: 'uri', uri: a0.uri.trim(), text: '', moduleId: '' },
          'A',
        )
      }
      if (a0?.type === 'postback' && typeof a0.data === 'string') {
        const mid = decodeTriggerModule(a0.data)
        if (mid) {
          return normalizeUnifiedAction(
            { type: 'module', moduleId: mid, text: '', uri: '' },
            'A',
          )
        }
      }
    }
    if (bodyText.trim()) return normalizeUnifiedAction({ type: 'message', text: bodyText }, 'A')
    return empty
  }

  if (first.type === 'text') {
    const t = String((first as { text?: string }).text || '')
    const btns = (first as { buttons?: Record<string, unknown>[] }).buttons
    if (Array.isArray(btns) && btns.length === 1) {
      const b = btns[0]
      if (b?.type === 'uri' && typeof b.uri === 'string' && b.uri.trim()) {
        return normalizeUnifiedAction({ type: 'uri', uri: b.uri.trim() }, 'A')
      }
      if (b?.type === 'module' && typeof b.moduleId === 'string' && b.moduleId.trim()) {
        return normalizeUnifiedAction({ type: 'module', moduleId: b.moduleId.trim() }, 'A')
      }
    }
    return normalizeUnifiedAction({ type: 'message', text: t }, 'A')
  }

  return empty
}

/** 將統一動作轉成 LINE Messaging API 可 multicast 的 messages（最多一則 template 或 text） */
export function unifiedActionToLineMessages(action: UnifiedAction): Record<string, unknown>[] {
  const a = normalizeUnifiedAction(action, 'A')

  if (a.type === 'message') {
    const text = a.text.trim()
    if (!text) return []
    return [{ type: 'text', text }]
  }

  if (a.type === 'uri') {
    const uri = a.uri.trim()
    if (!uri) return []
    const bodyText = '請點擊下方按鈕開啟連結。'.slice(0, 160)
    return [{
      type: 'template',
      altText: '開啟連結',
      template: {
        type: 'buttons',
        text: bodyText,
        actions: [{ type: 'uri', label: '開啟網址', uri }],
      },
    }]
  }

  const mid = a.moduleId.trim()
  if (!mid) return []
  const bodyText = '請點擊下方按鈕以進入機器人模組。'.slice(0, 160)
  return [{
    type: 'template',
    altText: '觸發機器人模組',
    template: {
      type: 'buttons',
      text: bodyText,
      actions: [{
        type: 'postback',
        label: '開始',
        data: encodeTriggerModule(mid),
      }],
    },
  }]
}
