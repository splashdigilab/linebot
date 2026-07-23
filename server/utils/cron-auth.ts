import type { H3Event } from 'h3'

/**
 * 外部 Cron 端點共用的身分驗證（/api/warmup、/api/cron/run-tasks、
 * /api/broadcast/trigger-scheduled）。
 *
 * 規則：請求 Header 的 X-Cron-Secret 必須與環境變數 CRON_SECRET 相符；
 * 未設定 CRON_SECRET 時只允許同主機（localhost）呼叫。驗證失敗直接 throw。
 */
export function assertCronAuthorized(event: H3Event): void {
  const runtimeConfig = useRuntimeConfig()
  const cronSecret = String(runtimeConfig.cronSecret || '').trim()
  const headerSecret = String(getHeader(event, 'x-cron-secret') || '').trim()

  if (cronSecret) {
    if (headerSecret !== cronSecret) {
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }
    return
  }

  const forwarded = getHeader(event, 'x-forwarded-for') || ''
  const host = getHeader(event, 'host') || ''
  const isLocal = forwarded === '' && (host.startsWith('localhost') || host.startsWith('127.'))
  if (!isLocal) {
    throw createError({ statusCode: 403, statusMessage: 'CRON_SECRET not configured; only localhost allowed' })
  }
}
