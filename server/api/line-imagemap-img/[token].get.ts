import { verifyImagemapImageToken } from '../../utils/line-imagemap-image-token'
import { respondImagemapImage } from '../../utils/line-imagemap-image-response'
import { getLineWorkspaceCredentials } from '../../utils/line-workspace-credentials'

/**
 * 保底相容路由：/api/line-imagemap-img/{token}
 * 若部分客戶端未附 size 也能正常轉址。
 */
export default defineEventHandler(async (event) => {
  const { channelSecret: secret } = await getLineWorkspaceCredentials()
  if (!secret) {
    throw createError({ statusCode: 503, statusMessage: 'Missing LINE channel secret' })
  }

  const token = String(getRouterParam(event, 'token') || '')
  const imageUrl = verifyImagemapImageToken(token, secret)
  if (!imageUrl) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid or expired token' })
  }

  return await respondImagemapImage(event, imageUrl)
})
