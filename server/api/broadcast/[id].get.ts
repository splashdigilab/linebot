import { getDoc } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import type { BroadcastDoc } from '~~/shared/types/tag-broadcast'

/**
 * GET /api/broadcast/:id
 * 取得推播詳情（含 messages 快照，供後台還原訊息內容）
 *
 * Query:
 * - withAudienceIds=1：一併回傳 audienceSnapshot.resolvedUserIds（可能很大，僅除錯／稽核用）
 *
 * 預設會省略 resolvedUserIds，避免單次回應過大。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const query = getQuery(event)
  const withAudienceIds = query.withAudienceIds === '1' || query.withAudienceIds === 'true'

  const doc = await getDoc<BroadcastDoc>('broadcasts', id)
  if (!doc || doc.workspaceId !== workspaceId) throw createError({ statusCode: 404, statusMessage: 'Broadcast not found' })

  if (withAudienceIds) return doc

  const snap = doc.audienceSnapshot
  return {
    ...doc,
    audienceSnapshot: {
      filter: snap?.filter ?? null,
      estimatedCount: snap?.estimatedCount ?? 0,
      resolvedUserIds: [],
    },
  }
})
