import { $fetch } from 'ofetch'
import { getLineWorkspaceCredentials } from '~~/server/utils/line-workspace-credentials'

// Bot basicId rarely changes — shared in-memory cache (config + claim endpoints)
const cacheByWorkspace = new Map<string, { lineOaBasicId: string; expiresAt: number }>()
const TTL_MS = 24 * 60 * 60 * 1000

/**
 * 解析官方帳號 Messaging API bot `basicId`（例：@abc123）。失敗或非 OA 環境時回傳空字串。
 */
export async function resolveLineOaBasicId(workspaceId: string): Promise<string> {
  const wid = String(workspaceId || '').trim()
  if (!wid) return ''

  const hit = cacheByWorkspace.get(wid)
  if (hit && hit.expiresAt > Date.now())
    return hit.lineOaBasicId

  const { channelAccessToken } = await getLineWorkspaceCredentials(wid)
  if (!channelAccessToken)
    return ''

  try {
    const botInfo = await $fetch<{ basicId?: string }>(
      'https://api.line.me/v2/bot/info',
      { headers: { Authorization: `Bearer ${channelAccessToken}` } },
    )
    const lineOaBasicId = String(botInfo?.basicId || '').trim()
    cacheByWorkspace.set(wid, { lineOaBasicId, expiresAt: Date.now() + TTL_MS })
    return lineOaBasicId
  }
  catch {
    return ''
  }
}
