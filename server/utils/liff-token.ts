/**
 * LIFF access token 驗證。
 *
 * LIFF 前端不可信任地自報 lineUserId（任何人都能 POST 任意 userId 觸發貼標／推播），
 * 因此一律要求前端改傳 `liff.getAccessToken()`，由後端向 LINE 驗證：
 *   1. GET /oauth2/v2.1/verify  — 確認 token 有效、未過期（並取得 client_id 供比對）
 *   2. GET /v2/profile          — 以 token 取得「真正的」userId / displayName / pictureUrl
 *
 * userId 以 LINE 回傳為準。LINE userId 以 provider 為範圍，攻擊者無法在我們的
 * provider 底下替別人的 userId 取得有效 token，因此可阻斷冒用。
 */

const LINE_API_BASE = 'https://api.line.me'

export interface VerifiedLiffUser {
  userId: string
  displayName: string
  pictureUrl: string
  /** token 所屬 LINE Login channel ID（供與 workspace 的 LIFF channel 比對） */
  clientId: string
}

/**
 * 驗證 LIFF access token 並取回真實使用者身分。
 * token 無效 / 過期 / 取不到 profile 一律丟 401。
 */
export async function verifyLiffAccessToken(accessToken: string): Promise<VerifiedLiffUser> {
  const token = String(accessToken || '').trim()
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'LIFF access token is required' })
  }

  // 1. token 有效性（LINE 官方 verify 端點要求 access_token 走 query string）
  let clientId = ''
  try {
    const verifyRes = await fetch(
      `${LINE_API_BASE}/oauth2/v2.1/verify?access_token=${encodeURIComponent(token)}`,
    )
    const verifyData = await verifyRes.json().catch(() => ({})) as {
      client_id?: string
      expires_in?: number
      error_description?: string
    }
    if (!verifyRes.ok || !(Number(verifyData?.expires_in) > 0)) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Invalid or expired LIFF access token',
      })
    }
    clientId = String(verifyData?.client_id || '')
  }
  catch (e: any) {
    if (e?.statusCode === 401) throw e
    console.error('[liff-token] verify request failed:', e)
    throw createError({ statusCode: 502, statusMessage: 'LINE token verification unavailable' })
  }

  // 2. 以 token 取得真實 profile（userId 不信任 client 自報）
  try {
    const profileRes = await fetch(`${LINE_API_BASE}/v2/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!profileRes.ok) {
      throw createError({ statusCode: 401, statusMessage: 'Invalid LIFF access token (profile)' })
    }
    const profile = await profileRes.json() as {
      userId?: string
      displayName?: string
      pictureUrl?: string
    }
    const userId = String(profile?.userId || '').trim()
    if (!userId) {
      throw createError({ statusCode: 401, statusMessage: 'Invalid LIFF access token (no userId)' })
    }
    return {
      userId,
      displayName: String(profile?.displayName || ''),
      pictureUrl: String(profile?.pictureUrl || ''),
      clientId,
    }
  }
  catch (e: any) {
    if (e?.statusCode === 401) throw e
    console.error('[liff-token] profile request failed:', e)
    throw createError({ statusCode: 502, statusMessage: 'LINE profile lookup unavailable' })
  }
}

/**
 * LIFF ID 格式為 `{loginChannelId}-{suffix}`；取出 channel ID 供與 token 的 client_id 比對。
 */
export function liffChannelIdFromLiffId(liffId: string): string {
  const m = /^(\d+)-/.exec(String(liffId || '').trim())
  return m?.[1] ?? ''
}

/**
 * 比對 token 的 client_id 與 workspace 設定的 LIFF channel。
 * 比對不上（或 workspace 沒設定 defaultLiffId）目前僅記 log，不阻擋——
 * 避免活動使用不同 Login channel 的合法情境被誤殺；userId 冒用已由 verify + profile 阻斷。
 */
export function warnOnLiffChannelMismatch(
  verified: VerifiedLiffUser,
  workspaceLiffId: string,
  context: string,
): void {
  const expected = liffChannelIdFromLiffId(workspaceLiffId)
  if (expected && verified.clientId && expected !== verified.clientId) {
    console.warn(
      `[liff-token] client_id mismatch in ${context}:`,
      'token client_id =', verified.clientId,
      'workspace LIFF channel =', expected,
    )
  }
}
