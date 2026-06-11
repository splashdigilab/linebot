/**
 * LINE webhook 事件冪等鎖。
 *
 * LINE 在沒收到 2xx（逾時等）時會重送 webhook（redelivery）。本系統處理事件是
 * 「全部處理完才回 200」，AI 回覆最壞可能跑到 ~10 秒，逾時重送會造成同一則訊息
 * 觸發兩次回覆、扣兩次 AI quota。這裡用 Firestore `create()`（已存在即失敗）對
 * `webhookEventId` 上鎖：第一次 create 成功者處理，之後的重送直接跳過。
 *
 * 取捨：鎖在「開始處理前」就寫入，若處理中途當機，重送也會被跳過（寧可漏一則
 * 罕見的當機事件，不要常態性重複發訊）。鎖文件帶 expiresAt，需在兩個 Firebase
 * 專案各設一條 TTL policy（collection group: webhookEventLocks, field: expiresAt）
 * 自動清理。
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getDb } from './firebase'

export const WEBHOOK_EVENT_LOCKS_COLLECTION = 'webhookEventLocks'

/** 鎖保留 24 小時；LINE redelivery 視窗遠小於此 */
const LOCK_TTL_MS = 24 * 60 * 60 * 1000

/**
 * 嘗試取得事件處理權。
 * 回傳 true = 第一次看到此事件，應處理；false = 已處理過（redelivery），跳過。
 * 沒有 webhookEventId 的事件、或 Firestore 故障時 fail-open（寧可重複不要漏接）。
 */
export async function claimWebhookEvent(
  workspaceId: string,
  webhookEventId: string | undefined,
): Promise<boolean> {
  const eventId = String(webhookEventId || '').trim()
  if (!eventId) return true

  const docId = `${workspaceId}_${eventId}`
  try {
    await getDb().collection(WEBHOOK_EVENT_LOCKS_COLLECTION).doc(docId).create({
      workspaceId,
      eventId,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + LOCK_TTL_MS),
    })
    return true
  }
  catch (e: any) {
    // gRPC code 6 = ALREADY_EXISTS：同一事件已被處理（redelivery）
    if (e?.code === 6) return false
    console.error('[webhook-dedup] claim failed (fail-open):', e)
    return true
  }
}
