/**
 * Handoff 通知：AI / 腳本把對話轉真人時，用官方帳號推播提醒指定客服人員。
 *
 * 設定來源：aiSettings.handoffNotify（enabled + lineUserIds）。
 * 限制：收通知的人必須是此官方帳號的好友（LINE push 的先天限制），設定頁有註明。
 * 同一位客人 10 分鐘內只通知一次（per-instance in-memory 節流；多實例下最壞情況
 * 是各實例各通知一次，可接受——通知漏發比重複發更糟）。
 */
import type { messagingApi } from '@line/bot-sdk'
import { pushMessage } from './line'
import { getAiSettings } from './ai-settings'
import { HANDOFF_REASON_LABELS } from '~~/shared/types/ai-knowledge'
import type { HandoffReason } from '~~/shared/types/ai-knowledge'
import { capMapSize } from './bounded-cache'

const NOTIFY_THROTTLE_MS = 10 * 60 * 1000
const NOTIFY_MAP_MAX_ENTRIES = 5000
const lastNotifiedAt = new Map<string, number>()

export interface HandoffNotifyParams {
  workspaceId: string
  /** 客人的 LINE userId（節流 key 用） */
  customerLineUserId: string
  /** 客人顯示名稱；沒有就帶 userId */
  customerName: string
  /** 觸發 handoff 的那則客人訊息（腳本流程可為空） */
  customerMessage: string
  /** null = 非 AI 護欄觸發（例如腳本設定轉真人） */
  reason: HandoffReason | null
  /** SLA 提醒模式：轉真人後超過 N 分鐘無人回應的再提醒（訊息格式不同） */
  slaReminderMinutes?: number
}

export async function notifyHandoffToStaff(params: HandoffNotifyParams): Promise<void> {
  const settings = await getAiSettings(params.workspaceId).catch(() => null)
  const cfg = settings?.handoffNotify
  if (!cfg?.enabled || !cfg.lineUserIds.length) return

  const throttleKey = `${params.workspaceId}:${params.customerLineUserId}`
  const last = lastNotifiedAt.get(throttleKey) ?? 0
  const now = Date.now()
  if (now - last < NOTIFY_THROTTLE_MS) return
  lastNotifiedAt.set(throttleKey, now)
  capMapSize(lastNotifiedAt, NOTIFY_MAP_MAX_ENTRIES)

  const reasonLabel = params.reason
    ? (HANDOFF_REASON_LABELS[params.reason] ?? params.reason)
    : '腳本轉真人'
  const lines = params.slaReminderMinutes
    ? [
        '⏰ 提醒：真人客服請求尚未回應',
        `客人：${params.customerName}`,
        `已等待超過 ${params.slaReminderMinutes} 分鐘`,
        '請至後台「對話」頁回覆。',
      ]
    : [
        '🙋 真人客服請求',
        `客人：${params.customerName}`,
        ...(params.customerMessage.trim() ? [`訊息：${params.customerMessage.trim().slice(0, 200)}`] : []),
        `原因：${reasonLabel}`,
        '請至後台「對話」頁回覆。',
      ]
  const msg: messagingApi.TextMessage = { type: 'text', text: lines.join('\n') }

  const results = await Promise.allSettled(
    cfg.lineUserIds.map(uid => pushMessage(uid, [msg], params.workspaceId)),
  )
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      // 最常見原因：該人員不是此官方帳號好友
      console.warn('[handoff-notify] push failed for', cfg.lineUserIds[i], r.reason?.message ?? r.reason)
    }
  })
}
