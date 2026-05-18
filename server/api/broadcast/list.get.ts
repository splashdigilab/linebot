import { listDocs } from '~~/server/utils/firebase'
import { paginateInMemoryList } from '~~/server/utils/paginated-collection-list'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import type { BroadcastDoc } from '~~/shared/types/tag-broadcast'

/**
 * GET /api/broadcast/list
 * Query: ?status=draft|scheduled|completed|...
 * Query: page, limit（有帶則回傳 { items, total, page, limit, hasMore }）
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'viewer')

  const query = getQuery(event)
  const statusFilter = query.status as string | undefined

  const broadcasts = await listDocs<BroadcastDoc>('broadcasts', ref =>
    ref.where('workspaceId', '==', workspaceId).orderBy('createdAt', 'desc'),
  )

  const filtered = statusFilter
    ? broadcasts.filter(b => b.status === statusFilter)
    : broadcasts

  const rows = filtered.map(({ audienceSnapshot, messages, ...rest }) => ({
    ...rest,
    audienceSnapshot: {
      estimatedCount: audienceSnapshot?.estimatedCount ?? 0,
      filter: audienceSnapshot?.filter ?? null,
    },
    messageCount: Array.isArray(messages) ? messages.length : 0,
  }))

  return paginateInMemoryList(rows, query)
})
