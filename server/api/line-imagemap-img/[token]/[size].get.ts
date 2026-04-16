import { verifyImagemapImageToken } from '../../../utils/line-imagemap-image-token'

/**
 * LINE Imagemap 標準路由：/api/line-imagemap-img/{token}/{size}
 * 例如 /.../abc123/1040，驗簽後 302 轉址到實際 PNG/JPG。
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const secret = config.lineChannelSecret
  if (!secret) {
    throw createError({ statusCode: 503, statusMessage: 'Missing LINE channel secret' })
  }

  const token = String(getRouterParam(event, 'token') || '')
  const imageUrl = verifyImagemapImageToken(token, secret)
  if (!imageUrl) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid or expired token' })
  }

  const size = String(getRouterParam(event, 'size') || '').replace(/\D/g, '')
  const allowedWidths = new Set(['1040', '700', '460', '300', '240'])
  if (size && !allowedWidths.has(size)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid size' })
  }

  return sendRedirect(event, imageUrl, 302)
})
