import { verifyImagemapImageToken } from '../utils/line-imagemap-image-token'

/**
 * LINE Imagemap 會請求 baseUrl + 寬度（例如 …&z=1040）。
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

  const z = String(q.z ?? '')
  const allowedWidths = new Set(['1040', '700', '460', '300', '240'])
  if (z && !allowedWidths.has(z)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid size' })
  }

  return sendRedirect(event, url, 302)
})
