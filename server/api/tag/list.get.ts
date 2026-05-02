import { listDocs } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import type { TagDoc } from '~~/shared/types/tag-broadcast'

/**
 * GET /api/tag/list
 * Query: ?status=active|inactive  (省略則回傳全部)
 * Query: ?category=interest|behavior|...
 *
 * Response: TagDoc & { id: string }[]
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')

  const query = getQuery(event)
  const statusFilter = query.status as string | undefined
  const categoryFilter = query.category as string | undefined

  // 只用 orderBy('createdAt')，避免與 where 組合而需要 Firestore 複合索引；
  // 標籤數量通常不大，status / category 在記憶體篩選即可。
  const tags = await listDocs<TagDoc>('tags', (ref) =>
    ref.where('workspaceId', '==', workspaceId).orderBy('createdAt', 'desc'),
  )

  let result = tags
  if (statusFilter) result = result.filter((t) => t.status === statusFilter)
  if (categoryFilter) result = result.filter((t) => t.category === categoryFilter)

  return result
})
