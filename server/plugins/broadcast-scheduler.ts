import { Cron } from 'croner'
import { runDueScheduledBroadcasts } from '../utils/run-due-scheduled-broadcasts'

/**
 * 應用內建排程推播檢查（每分鐘）。
 * Amplify Hosting Compute / Node 長駐進程下會自動執行，無需另設 Cloud Scheduler。
 *
 * - 需設定 CRON_SECRET（與對話清理相同）
 * - 若已用 AWS EventBridge 呼叫 /api/broadcast/trigger-scheduled，可設 BROADCAST_CRON_ENABLED=false 避免重複觸發（仍安全，有 transaction 防重）
 */
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return

  const cronSecret = String(process.env.CRON_SECRET || '').trim()
  if (!cronSecret) {
    console.warn(
      '[broadcast-scheduler] 未設定 CRON_SECRET，內建排程檢查未啟動。'
      + '請設定 CRON_SECRET，或每分鐘呼叫 POST /api/broadcast/trigger-scheduled',
    )
    return
  }

  if (String(process.env.BROADCAST_CRON_ENABLED || 'true').toLowerCase() === 'false') {
    console.log('[broadcast-scheduler] BROADCAST_CRON_ENABLED=false，內建排程檢查已關閉')
    return
  }

  let running = false

  Cron('* * * * *', async () => {
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
