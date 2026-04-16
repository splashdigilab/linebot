import { verifyImagemapImageToken } from '../utils/line-imagemap-image-token'

function normalizeSize(raw: string): string {
  // 兼容 LINE 可能送來的 `1040` 或 `/1040` 形式
  const digits = String(raw || '').replace(/\D/g, '')
  return digits
}

/**
 * 舊版 query 形式相容路由：/api/line-imagemap-img?token=...&z=1040
 * 驗簽後 302 轉到實際圖檔，讓聊天室內可保留 PNG 透明（Flex 會把透明當白底）。
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const secret = config.lineChannelSecret
  if (!secret) {
    throw createError({ statusCode: 503, statusMessage: 'Missing LINE channel secret' })
  }

  const q = getQuery(event)
  const token = String(q.token ?? '')
  const url = verifyImagemapImageToken(token, secret)
  if (!url) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid or expired token' })
  }

  const z = normalizeSize(String(q.z ?? ''))
  const allowedWidths = new Set(['1040', '700', '460', '300', '240'])
  if (z && !allowedWidths.has(z)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid size' })
  }

  return sendRedirect(event, url, 302)
})
