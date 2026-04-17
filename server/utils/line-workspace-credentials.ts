import { getDb } from './firebase'
import type { LineWorkspaceDoc } from '~~/shared/line-workspace'
import { DEFAULT_LINE_WORKSPACE_ID } from '~~/shared/line-workspace'

export type ResolvedLineCredentials = {
  channelAccessToken: string
  channelSecret: string
  /** 活動 CTA 等可選用 */
  defaultLiffId: string
}

const TTL_MS = 60 * 1000

let cache: (ResolvedLineCredentials & { expiresAt: number }) | null = null

export function invalidateLineWorkspaceCredentialsCache() {
  cache = null
}

/**
 * 讀取 LINE Messaging 憑證：優先 Firestore `workspaces/default`，否則 fallback `runtimeConfig` / process.env。
 * 結果短暫快取，避免每則 webhook 都打 Firestore。
 */
export async function getLineWorkspaceCredentials(): Promise<ResolvedLineCredentials> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) {
    return {
      channelAccessToken: cache.channelAccessToken,
      channelSecret: cache.channelSecret,
      defaultLiffId: cache.defaultLiffId,
    }
  }

  let channelAccessToken = ''
  let channelSecret = ''
  let defaultLiffId = ''

  try {
    const db = getDb()
    const snap = await db.collection('workspaces').doc(DEFAULT_LINE_WORKSPACE_ID).get()
    if (snap.exists) {
      const d = snap.data() as LineWorkspaceDoc
      channelAccessToken = String(d?.channelAccessToken ?? '').trim()
      channelSecret = String(d?.channelSecret ?? '').trim()
      defaultLiffId = String(d?.defaultLiffId ?? '').trim()
    }
  }
  catch (e) {
    console.warn('[line-workspace] read workspaces/default failed:', e)
  }

  if (!channelAccessToken || !channelSecret) {
    try {
      const config = useRuntimeConfig()
      channelAccessToken = String(config.lineChannelAccessToken || '').trim()
      channelSecret = String(config.lineChannelSecret || '').trim()
    }
    catch {
      channelAccessToken = String(process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
      channelSecret = String(process.env.LINE_CHANNEL_SECRET || '').trim()
    }
  }

  if (!defaultLiffId) {
    defaultLiffId = String(process.env.LIFF_DEFAULT_ID || '').trim()
  }

  const resolved: ResolvedLineCredentials = {
    channelAccessToken,
    channelSecret,
    defaultLiffId,
  }
  cache = { ...resolved, expiresAt: now + TTL_MS }
  return resolved
}
