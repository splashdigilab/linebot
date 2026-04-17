import { listDocs } from '~~/server/utils/firebase'
import type { BroadcastDoc } from '~~/shared/types/tag-broadcast'

/**
 * GET /api/broadcast/list
 * Query: ?status=draft|scheduled|completed|...
 *
 * Response: Array<BroadcastDoc & { id: string }>（不含 messages、不含 audienceSnapshot.resolvedUserIds；編輯內容請 GET /api/broadcast/:id）
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const statusFilter = query.status as string | undefined

  const broadcasts = await listDocs<BroadcastDoc>('broadcasts', (ref) =>
    ref.orderBy('createdAt', 'desc'),
  )

  const filtered = statusFilter
    ? broadcasts.filter((b) => b.status === statusFilter)
    : broadcasts

  // 移除大型快照欄位，前端列表不需要
  return filtered.map(({ audienceSnapshot, messages, ...rest }) => ({
    ...rest,
    audienceSnapshot: {
      estimatedCount: audienceSnapshot?.estimatedCount ?? 0,
      filter: audienceSnapshot?.filter ?? null,
    },
    messageCount: Array.isArray(messages) ? messages.length : 0,
  }))
})
