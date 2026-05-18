import { runDueScheduledBroadcasts } from '~~/server/utils/run-due-scheduled-broadcasts'

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
  // ── 身分驗證 ──────────────────────────────────────────────────────
  const runtimeConfig = useRuntimeConfig()
  const cronSecret = String(runtimeConfig.cronSecret || '').trim()
  const headerSecret = String(getHeader(event, 'x-cron-secret') || '').trim()

  if (cronSecret) {
    if (headerSecret !== cronSecret) {
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }
  }
  else {
    // 未設定 CRON_SECRET 時只允許 localhost 呼叫
    const forwarded = getHeader(event, 'x-forwarded-for') || ''
    const host = getHeader(event, 'host') || ''
    const isLocal = forwarded === '' && (host.startsWith('localhost') || host.startsWith('127.'))
    if (!isLocal) {
      throw createError({ statusCode: 403, statusMessage: 'CRON_SECRET not configured; only localhost allowed' })
    }
  }

  return await runDueScheduledBroadcasts()
})
