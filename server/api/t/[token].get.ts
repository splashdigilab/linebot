import { verifyUriTagToken } from '~~/server/utils/line-action-tag-token'
import { addTagsToUser } from '~~/server/utils/tagging'
import { listWorkspaceLineCredentials } from '~~/server/utils/line-workspace-credentials'
import { lineUserFirestoreDocId } from '~~/shared/line-workspace'

/**
 * GET /api/t/:token
 * 點擊 URI 後先套用貼標，再 302 到原目標網址。
 */
export default defineEventHandler(async (event) => {
  const token = String(getRouterParam(event, 'token') || '')
  if (!token) return sendRedirect(event, '/', 302)

  const candidates = await listWorkspaceLineCredentials()
  let parsed: { targetUrl: string; userId: string; tagIds: string[] } | null = null
  let matchedWorkspaceId = ''
  for (const row of candidates) {
    const secret = String(row.credentials.channelSecret || '').trim()
    if (!secret) continue
    const verified = verifyUriTagToken(token, secret)
    if (verified) {
      parsed = verified
      matchedWorkspaceId = row.workspaceId
      break
    }
  }
  if (!parsed) return sendRedirect(event, '/', 302)

  try {
    if (parsed.tagIds.length > 0) {
      await addTagsToUser(
        lineUserFirestoreDocId(parsed.userId, matchedWorkspaceId),
        parsed.tagIds,
        'system',
        'uri-click',
        matchedWorkspaceId,
      )
    }
  }
  catch (e) {
    console.error('[uri-tag] failed to apply tags:', e)
  }

  return sendRedirect(event, parsed.targetUrl, 302)
})

