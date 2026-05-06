import { getDb } from './firebase'
import type { LineWorkspaceDoc } from '~~/shared/line-workspace'

export type ResolvedLineCredentials = {
  channelAccessToken: string
  channelSecret: string
  /** 活動 CTA 等可選用 */
  defaultLiffId: string
}

const TTL_MS = 60 * 1000

const cacheByWorkspace = new Map<string, ResolvedLineCredentials & { expiresAt: number }>()
let workspaceCredentialListCache: Array<{ workspaceId: string; credentials: ResolvedLineCredentials }> | null = null
let workspaceCredentialListExpiresAt = 0

export function invalidateLineWorkspaceCredentialsCache() {
  cacheByWorkspace.clear()
  workspaceCredentialListCache = null
  workspaceCredentialListExpiresAt = 0
}

/**
 * 讀取 LINE Messaging 憑證：僅使用指定 workspace，不再 fallback 到 `workspaces/default`。
 * 結果短暫快取，避免每則 webhook 都打 Firestore。
 */
export async function getLineWorkspaceCredentials(workspaceId: string): Promise<ResolvedLineCredentials> {
  const requestedWorkspaceId = String(workspaceId || '').trim()
  if (!requestedWorkspaceId) {
    throw new Error('workspaceId is required for LINE workspace credentials')
  }
  const now = Date.now()
  const cacheKey = requestedWorkspaceId
  const cached = cacheByWorkspace.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return {
      channelAccessToken: cached.channelAccessToken,
      channelSecret: cached.channelSecret,
      defaultLiffId: cached.defaultLiffId,
    }
  }

  const fromRequested: Partial<ResolvedLineCredentials> = {}
  try {
    const db = getDb()
    const requestedSnap = await db.collection('workspaces').doc(requestedWorkspaceId).get()
    if (requestedSnap.exists) {
      const d = requestedSnap.data() as LineWorkspaceDoc
      fromRequested.channelAccessToken = String(d?.channelAccessToken ?? '').trim()
      fromRequested.channelSecret = String(d?.channelSecret ?? '').trim()
      fromRequested.defaultLiffId = String(d?.defaultLiffId ?? '').trim()
    }

  }
  catch (e) {
    console.warn('[line-workspace] read workspace credentials failed:', e)
  }

  const resolved: ResolvedLineCredentials = {
    channelAccessToken: fromRequested.channelAccessToken || '',
    channelSecret: fromRequested.channelSecret || '',
    defaultLiffId: fromRequested.defaultLiffId || '',
  }
  cacheByWorkspace.set(cacheKey, { ...resolved, expiresAt: now + TTL_MS })
  return resolved
}

/**
 * 列出所有已設定 LINE 憑證的 workspace（供 webhook／token 驗證時比對）。
 */
export async function listWorkspaceLineCredentials(): Promise<Array<{ workspaceId: string; credentials: ResolvedLineCredentials }>> {
  const now = Date.now()
  if (workspaceCredentialListCache && workspaceCredentialListExpiresAt > now) {
    return workspaceCredentialListCache
  }

  const db = getDb()
  const snap = await db.collection('workspaces').get()
  const rows: Array<{ workspaceId: string; credentials: ResolvedLineCredentials }> = []

  for (const doc of snap.docs) {
    const d = doc.data() as LineWorkspaceDoc
    const credentials: ResolvedLineCredentials = {
      channelAccessToken: String(d?.channelAccessToken ?? '').trim(),
      channelSecret: String(d?.channelSecret ?? '').trim(),
      defaultLiffId: String(d?.defaultLiffId ?? '').trim(),
    }
    if (!credentials.channelAccessToken && !credentials.channelSecret && !credentials.defaultLiffId) continue
    rows.push({ workspaceId: doc.id, credentials })
    cacheByWorkspace.set(doc.id, { ...credentials, expiresAt: now + TTL_MS })
  }

  workspaceCredentialListCache = rows
  workspaceCredentialListExpiresAt = now + TTL_MS
  return rows
}
