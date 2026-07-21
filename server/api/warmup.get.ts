import { listWorkspaceLineCredentials } from '~~/server/utils/line-workspace-credentials'
import { warmWorkspaceAutomationCaches } from '~~/server/utils/handler'

/**
 * GET /api/warmup
 *
 * 保溫端點：由外部 Cron（cron-job.org／UptimeRobot／EventBridge）每 1〜2 分鐘呼叫。
 * 目的有二：
 *   1. 讓 Amplify Lambda 執行個體不因閒置被回收（避免冷啟動 2〜5 秒）
 *   2. 重整 webhook 回覆關鍵路徑上的 in-memory 快取（LINE 憑證、自動回覆規則、
 *      腳本、AI 設定、模組 flow＋圖文快照），客人觸發機器人模組時直接走全快取路徑
 *
 * 保護機制：與 /api/broadcast/trigger-scheduled 相同——Header 需帶 X-Cron-Secret
 * 且與環境變數 CRON_SECRET 相符；未設定 CRON_SECRET 時僅允許 localhost。
 */
export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const cronSecret = String(runtimeConfig.cronSecret || '').trim()
  const headerSecret = String(getHeader(event, 'x-cron-secret') || '').trim()

  if (cronSecret) {
    if (headerSecret !== cronSecret) {
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }
  }
  else {
    const forwarded = getHeader(event, 'x-forwarded-for') || ''
    const host = getHeader(event, 'host') || ''
    const isLocal = forwarded === '' && (host.startsWith('localhost') || host.startsWith('127.'))
    if (!isLocal) {
      throw createError({ statusCode: 403, statusMessage: 'CRON_SECRET not configured; only localhost allowed' })
    }
  }

  const startedAt = Date.now()
  const workspaces = await listWorkspaceLineCredentials()
  const results = await Promise.all(workspaces.map(w =>
    warmWorkspaceAutomationCaches(w.workspaceId)
      .then(() => ({ workspaceId: w.workspaceId, ok: true }))
      .catch((e) => {
        console.warn('[warmup] workspace warm failed:', w.workspaceId, e)
        return { workspaceId: w.workspaceId, ok: false }
      }),
  ))
  return { warmed: results, ms: Date.now() - startedAt }
})
