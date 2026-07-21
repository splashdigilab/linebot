import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * 有效期以 30 天為一桶、對齊固定紀元:同一張圖在同一桶內簽出完全相同的 token。
 * exp 若用「當下 + TTL」會每毫秒都不同 → 每次發送的 baseUrl 都不同,LINE 手機端
 * 與 CDN 的快取全部失效,同一張圖每次觸發都重新下載(圖文訊息秒數級延遲的主因)。
 * exp 取「下下個桶界」,保證任一時點簽出的 token 至少還有 30 天、至多 60 天壽命。
 */
const TOKEN_BUCKET_MS = 30 * 24 * 60 * 60 * 1000

type Payload = { u: string; exp: number }

function signPayload(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

/** 產生給 Imagemap baseUrl 用的 token（LINE 會以 baseUrl + 寬度數字請求圖檔） */
export function createImagemapImageToken(imageUrl: string, secret: string): string {
  const exp = (Math.floor(Date.now() / TOKEN_BUCKET_MS) + 2) * TOKEN_BUCKET_MS
  const body: Payload = { u: imageUrl, exp }
  const json = JSON.stringify(body)
  const sig = signPayload(json, secret)
  return Buffer.from(JSON.stringify({ ...body, sig }), 'utf8').toString('base64url')
}

export function verifyImagemapImageToken(token: string, secret: string): string | null {
  if (!token || !secret) return null
  try {
    const raw = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as Payload & { sig: string }
    if (!raw?.u || typeof raw.exp !== 'number' || typeof raw.sig !== 'string') return null
    if (Date.now() > raw.exp) return null
    const json = JSON.stringify({ u: raw.u, exp: raw.exp })
    const expected = signPayload(json, secret)
    const a = Buffer.from(expected)
    const b = Buffer.from(raw.sig)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    if (!/^https:\/\//i.test(raw.u)) return null
    return raw.u
  }
  catch {
    return null
  }
}
