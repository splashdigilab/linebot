import { runDueScheduledBroadcasts } from '~~/server/utils/run-due-scheduled-broadcasts'
import { assertCronAuthorized } from '~~/server/utils/cron-auth'

/**
 * POST /api/broadcast/trigger-scheduled
 *
 * 由 Cron Job / Cloud Scheduler 定期呼叫（建議每分鐘）。
 * 查詢所有 status=scheduled 且 scheduleAt <= 現在 的推播，逐一發送。
 *
 * 保護機制：請求 Header 必須帶 X-Cron-Secret，值與環境變數 CRON_SECRET 相符。
 * 若未設定 CRON_SECRET，則只允許同主機（127.0.0.1）呼叫。
 *
 * Response:
 * {
 *   triggered: number           // 本次找到幾個排程推播
 *   results: Array<{
 *     id: string
 *     success: boolean
 *     error?: string
 *   }>
 * }
 */
export default defineEventHandler(async (event) => {
  assertCronAuthorized(event)
  return await runDueScheduledBroadcasts()
})
