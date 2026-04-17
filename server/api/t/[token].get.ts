import { verifyUriTagToken } from '~~/server/utils/line-action-tag-token'
import { addTagsToUser } from '~~/server/utils/tagging'

/**
 * GET /api/t/:token
 * 點擊 URI 後先套用貼標，再 302 到原目標網址。
 */
export default defineEventHandler(async (event) => {
  const token = String(getRouterParam(event, 'token') || '')
  if (!token) return sendRedirect(event, '/', 302)

  let secret = ''
  try {
    secret = String(useRuntimeConfig().lineChannelSecret || '')
  }
  catch {
    secret = String(process.env.LINE_CHANNEL_SECRET || '')
  }
  const parsed = verifyUriTagToken(token, secret)
  if (!parsed) return sendRedirect(event, '/', 302)

  try {
    if (parsed.tagIds.length > 0) {
      await addTagsToUser(parsed.userId, parsed.tagIds, 'system', 'uri-click')
    }
  }
  catch (e) {
    console.error('[uri-tag] failed to apply tags:', e)
  }

  return sendRedirect(event, parsed.targetUrl, 302)
})

