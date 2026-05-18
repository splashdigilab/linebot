import { getDb, listDocs } from '~~/server/utils/firebase'
import { sortRegularFlows } from '~~/server/utils/flow-sort'
import { seedWorkspaceSystemModules } from '~~/server/utils/workspace-system-modules'
import {
  buildPaginatedListResult,
  isPaginatedListQuery,
} from '~~/server/utils/paginated-collection-list'
import { parseAdminListPagination } from '~~/server/utils/admin-pagination'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

function stripFlowTriggers(flow: Record<string, unknown>) {
  const { triggers, trigger, ...rest } = flow
  return rest
}

const SYSTEM_MODULE_ORDER = ['welcome', 'live_agent'] as const

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'viewer')
  const query = getQuery(event)

  await seedWorkspaceSystemModules(getDb(), workspaceId)

  const allFlows = await listDocs<Record<string, unknown>>('flows', ref =>
    ref.where('workspaceId', '==', workspaceId).orderBy('createdAt', 'desc'),
  )

  const systemFlows = allFlows
    .filter(f => f.isSystem)
    .sort((a, b) => {
      const ai = SYSTEM_MODULE_ORDER.indexOf(a.moduleType as typeof SYSTEM_MODULE_ORDER[number])
      const bi = SYSTEM_MODULE_ORDER.indexOf(b.moduleType as typeof SYSTEM_MODULE_ORDER[number])
      return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai)
        - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi)
    })
    .map(stripFlowTriggers)

  const regularFlows = sortRegularFlows(allFlows.filter(f => !f.isSystem)).map(stripFlowTriggers)

  if (!isPaginatedListQuery(query)) {
    return [...systemFlows, ...regularFlows]
  }

  const { page, limit, offset } = parseAdminListPagination(query)
  const total = systemFlows.length + regularFlows.length
  const systemCount = systemFlows.length

  let items: Record<string, unknown>[]
  if (page === 1) {
    const regularLimit = Math.max(0, limit - systemCount)
    items = [...systemFlows, ...regularFlows.slice(0, regularLimit)]
  }
  else {
    const regularOffset = offset - systemCount
    items = regularFlows.slice(regularOffset, regularOffset + limit)
  }

  const result = buildPaginatedListResult(items, page, limit, total)
  return { ...result, items }
})
