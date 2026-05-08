import { getLineWorkspaceCredentials } from '~~/server/utils/line-workspace-credentials'
import { resolveLineOaBasicId } from '~~/server/utils/line-oa-basic-id'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const workspaceId = String(q.workspaceId || '').trim()
  if (!workspaceId) return { liffId: '', lineOaBasicId: '' }
  const { defaultLiffId } = await getLineWorkspaceCredentials(workspaceId)

  let lineOaBasicId = ''
  try {
    lineOaBasicId = await resolveLineOaBasicId(workspaceId)
  }
  catch {
    // non-critical — LIFF page degrades gracefully without add-friend link
  }

  // Allow browser and CDN to cache this response for 5 minutes
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')

  return { liffId: defaultLiffId, lineOaBasicId }
})
