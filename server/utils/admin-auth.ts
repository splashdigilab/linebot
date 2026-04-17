import type { H3Event } from 'h3'
import { getFirebaseAuth } from './firebase'

/**
 * 驗證前端附帶的 Firebase ID Token（Authorization: Bearer …）。
 * 用於後台 API，與 Nuxt middleware 的登入狀態一致。
 */
export async function requireFirebaseAuth(event: H3Event) {
  const header = getHeader(event, 'authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  const token = match?.[1]?.trim()
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  try {
    return await getFirebaseAuth().verifyIdToken(token)
  }
  catch {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or expired token' })
  }
}
