import { runDueScheduledBroadcasts } from '../utils/run-due-scheduled-broadcasts'

const TICK_INTERVAL_MS = 55_000

let lastTickAt = 0
let ticking = false

/**
 * 有 API 流量時順便檢查到期排程（彌補 Amplify 無長駐 Cron 的情況）。
 * server-side middleware 本身已有保護，無需 CRON_SECRET。
 * 與內建 croner、手動 trigger-scheduled 並存（transaction 防重複發送）。
 */
export default defineEventHandler((event) => {
  if (import.meta.prerender) return

  const path = String(event.path || '')
  if (!path.startsWith('/api/')) return
  if (path.includes('/broadcast/trigger-scheduled')) return
  if (path.includes('/broadcast/process-due')) return

  const now = Date.now()
  if (ticking || now - lastTickAt < TICK_INTERVAL_MS) return

  ticking = true
  lastTickAt = now

  runDueScheduledBroadcasts()
    .then((out) => {
      if (out.triggered > 0) {
        console.log('[broadcast-scheduler-tick] 已觸發', out.triggered, '則到期推播')
      }
    })
    .catch((e) => {
      console.error('[broadcast-scheduler-tick] 失敗', e)
    })
    .finally(() => {
      ticking = false
    })
})
