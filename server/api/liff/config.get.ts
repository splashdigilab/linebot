import { $fetch } from 'ofetch'
import { getLineWorkspaceCredentials } from '~~/server/utils/line-workspace-credentials'

export default defineEventHandler(async () => {
  const { defaultLiffId, channelAccessToken } = await getLineWorkspaceCredentials()

  let lineOaBasicId = ''
  if (channelAccessToken) {
    try {
      const botInfo = await $fetch<{ basicId?: string }>(
        'https://api.line.me/v2/bot/info',
        { headers: { Authorization: `Bearer ${channelAccessToken}` } },
      )
      lineOaBasicId = String(botInfo?.basicId || '').trim()
    }
    catch {
      // non-critical — LIFF page degrades gracefully without add-friend link
    }
  }

  return { liffId: defaultLiffId, lineOaBasicId }
})
