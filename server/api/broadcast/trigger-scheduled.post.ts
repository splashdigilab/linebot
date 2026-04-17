import { Timestamp } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { executeBroadcastSend } from '~~/server/utils/broadcast-send'

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

  // ── 查詢到期排程推播 ──────────────────────────────────────────────
  const db = getDb()
  const now = Timestamp.now()

  const snap = await db.collection('broadcasts')
    .where('status', '==', 'scheduled')
    .where('scheduleAt', '<=', now)
    .orderBy('scheduleAt', 'asc')
    .limit(20)
    .get()

  if (snap.empty) {
    return { triggered: 0, results: [] }
  }

  console.log(`[trigger-scheduled] 找到 ${snap.docs.length} 個到期排程推播`)

  // ── 逐一發送（不使用 Promise.all，避免同時衝擊 LINE API 限流）────
  const results: Array<{ id: string; success: boolean; error?: string }> = []

  for (const doc of snap.docs) {
    const id = doc.id
    try {
      const result = await executeBroadcastSend(id)
      results.push({ id, success: result.success })
      console.log(`[trigger-scheduled] ✓ ${id} sentCount=${result.sentCount}`)
    }
    catch (e: any) {
      const error = String(e?.message ?? e)
      results.push({ id, success: false, error })
      console.error(`[trigger-scheduled] ✗ ${id}`, error)
    }
  }

  return {
    triggered: snap.docs.length,
    results,
  }
})
