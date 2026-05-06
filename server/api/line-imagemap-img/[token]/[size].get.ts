import { verifyImagemapImageToken } from '../../../utils/line-imagemap-image-token'
import { respondImagemapImage } from '../../../utils/line-imagemap-image-response'
import { listWorkspaceLineCredentials } from '../../../utils/line-workspace-credentials'

/**
 * LINE Imagemap 標準路由：/api/line-imagemap-img/{token}/{size}
 * 例如 /.../abc123/1040，驗簽後 302 轉址到實際 PNG/JPG。
 */
export default defineEventHandler(async (event) => {
  const token = String(getRouterParam(event, 'token') || '')
  const candidates = await listWorkspaceLineCredentials()
  let imageUrl: string | null = null
  for (const row of candidates) {
    const secret = String(row.credentials.channelSecret || '').trim()
    if (!secret) continue
    const verified = verifyImagemapImageToken(token, secret)
    if (verified) {
      imageUrl = verified
      break
    }
  }
  if (!imageUrl) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid or expired token' })
  }

  // 桌機/手機 LINE 可能帶不同尺寸格式（例如 1040、1040x1040、/1040），此路由僅驗證 token，不限制尺寸值
  const sizeRaw = String(getRouterParam(event, 'size') || '').trim()
  const size = (sizeRaw.match(/(\d{2,5})/)?.[1]) || ''
  if (sizeRaw && !size) {
    console.warn('[line-imagemap-img] unexpected size segment:', sizeRaw)
  }

  return await respondImagemapImage(event, imageUrl)
})
