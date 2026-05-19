import { Cron } from 'croner'
import { runDueScheduledBroadcasts } from '../utils/run-due-scheduled-broadcasts'

/**
 * 應用內建排程推播檢查（每分鐘）。
 * 本機 dev / Node 長駐進程（Compute）下自動執行。
 * Amplify Lambda（無長駐 process）下 Cron 不會跨請求持續，
 * 此時由 broadcast-scheduler-tick.ts middleware + 前端輪詢擔任備援。
 *
 * - 若已用 AWS EventBridge 呼叫 /api/broadcast/trigger-scheduled，可設 BROADCAST_CRON_ENABLED=false 避免重複觸發（仍安全，有 transaction 防重）
 */
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return

  if (String(process.env.BROADCAST_CRON_ENABLED || 'true').toLowerCase() === 'false') {
    console.log('[broadcast-scheduler] BROADCAST_CRON_ENABLED=false，內建排程檢查已關閉')
    return
  }

  let running = false

  new Cron('* * * * *', async () => {
    if (running) return
    running = true
    try {
      const out = await runDueScheduledBroadcasts()
      if (out.triggered > 0) {
        console.log('[broadcast-scheduler] 已觸發', out.triggered, '則推播', out.results)
      }
    }
    catch (e) {
      console.error('[broadcast-scheduler] 執行失敗', e)
    }
    finally {
      running = false
    }
  })

  console.log('[broadcast-scheduler] 已啟動（每分鐘檢查到期排程推播）')
})
