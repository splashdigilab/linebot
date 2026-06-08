import { getDb } from '~~/server/utils/firebase'
import { queryCollectionPage } from '~~/server/utils/paginated-collection-list'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { SCRIPTS_COLLECTION } from '~~/server/utils/ai-scripts'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'viewer')
  const query = getQuery(event)
  const db = getDb()
  return queryCollectionPage(
    db,
    ref => ref
      .where('workspaceId', '==', workspaceId)
      .orderBy('createdAt', 'desc'),
    SCRIPTS_COLLECTION,
    query,
    (id, data) => ({ id, ...data }),
  )
})
