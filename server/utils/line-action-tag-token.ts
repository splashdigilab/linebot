import { createHmac, timingSafeEqual } from 'node:crypto'

type UriTagPayload = {
  u: string
  tags: string[]
  uid: string
  exp: number
}

const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000 // 14 days

function signPayload(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function createUriTagToken(input: { targetUrl: string; userId: string; tagIds: string[] }, secret: string): string {
  const body: UriTagPayload = {
    u: String(input.targetUrl || '').trim(),
    uid: String(input.userId || '').trim(),
    tags: Array.isArray(input.tagIds) ? input.tagIds.map((v) => String(v || '').trim()).filter(Boolean) : [],
    exp: Date.now() + TOKEN_TTL_MS,
  }
  const payload = JSON.stringify(body)
  const sig = signPayload(payload, secret)
  return Buffer.from(JSON.stringify({ ...body, sig }), 'utf8').toString('base64url')
}

export function verifyUriTagToken(token: string, secret: string): { targetUrl: string; userId: string; tagIds: string[] } | null {
  if (!token || !secret) return null
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as UriTagPayload & { sig: string }
    if (!parsed?.u || !parsed?.uid || typeof parsed.exp !== 'number' || typeof parsed.sig !== 'string') return null
    if (Date.now() > parsed.exp) return null
    if (!/^https?:\/\//i.test(parsed.u)) return null

    const payload = JSON.stringify({
      u: parsed.u,
      uid: parsed.uid,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      exp: parsed.exp,
    })
    const expected = signPayload(payload, secret)
    const a = Buffer.from(expected)
    const b = Buffer.from(parsed.sig)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null

    return {
      targetUrl: parsed.u,
      userId: parsed.uid,
      tagIds: Array.isArray(parsed.tags) ? parsed.tags.map((v) => String(v || '').trim()).filter(Boolean) : [],
    }
  }
  catch {
    return null
  }
}

