import { $fetch } from 'ofetch'
import { getLineWorkspaceCredentials } from '~~/server/utils/line-workspace-credentials'

// Bot basicId never changes — cache in server memory for 24 hours
let botInfoCache: { lineOaBasicId: string; expiresAt: number } | null = null

export default defineEventHandler(async (event) => {
  const { defaultLiffId, channelAccessToken } = await getLineWorkspaceCredentials()

  let lineOaBasicId = ''
  if (botInfoCache && botInfoCache.expiresAt > Date.now()) {
    lineOaBasicId = botInfoCache.lineOaBasicId
  }
  else if (channelAccessToken) {
    try {
      const botInfo = await $fetch<{ basicId?: string }>(
        'https://api.line.me/v2/bot/info',
        { headers: { Authorization: `Bearer ${channelAccessToken}` } },
      )
      lineOaBasicId = String(botInfo?.basicId || '').trim()
      botInfoCache = { lineOaBasicId, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }
    }
    catch {
      // non-critical — LIFF page degrades gracefully without add-friend link
    }
  }

  // Allow browser and CDN to cache this response for 5 minutes
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')

  return { liffId: defaultLiffId, lineOaBasicId }
})
