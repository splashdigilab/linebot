import { createHmac, timingSafeEqual } from 'node:crypto'

const TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000 // 60 天

type Payload = { u: string; exp: number }

function signPayload(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

/** 產生給 Imagemap baseUrl 用的 token（LINE 會以 baseUrl + 寬度數字請求圖檔） */
export function createImagemapImageToken(imageUrl: string, secret: string): string {
  const exp = Date.now() + TOKEN_TTL_MS
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
