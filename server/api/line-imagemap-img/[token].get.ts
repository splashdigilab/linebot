import { verifyImagemapImageToken } from '../../utils/line-imagemap-image-token'
import { respondImagemapImage } from '../../utils/line-imagemap-image-response'
import { listWorkspaceLineCredentials } from '../../utils/line-workspace-credentials'

/**
 * 保底相容路由：/api/line-imagemap-img/{token}
 * 若部分客戶端未附 size 也能正常轉址。
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

  return await respondImagemapImage(event, imageUrl)
})
