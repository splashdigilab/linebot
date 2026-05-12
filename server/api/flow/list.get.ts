import { getDb } from '~~/server/utils/firebase'
import { seedWorkspaceSystemModules } from '~~/server/utils/workspace-system-modules'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

function stripFlowTriggers(flow: Record<string, unknown>) {
  const { triggers, trigger, ...rest } = flow
  return rest
}

// 系統模組顯示順序（避免依賴 createdAt 的微小時差）
const SYSTEM_MODULE_ORDER = ['welcome', 'live_agent'] as const

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')

  // Auto-create system modules if missing (transparent fix for all existing workspaces)
  await seedWorkspaceSystemModules(getDb(), workspaceId)

  // 使用 DESC 以對齊 firestore.indexes.json 中既有的 (workspaceId ASC + createdAt DESC) 複合索引
  const allFlows = await listDocs<Record<string, unknown>>('flows', (ref) =>
    ref.where('workspaceId', '==', workspaceId).orderBy('createdAt', 'desc'),
  )

  // 系統模組依固定順序排序；一般流程已是新→舊
  const systemFlows = allFlows
    .filter((f) => f.isSystem)
    .sort((a, b) => {
      const ai = SYSTEM_MODULE_ORDER.indexOf(a.moduleType as typeof SYSTEM_MODULE_ORDER[number])
      const bi = SYSTEM_MODULE_ORDER.indexOf(b.moduleType as typeof SYSTEM_MODULE_ORDER[number])
      return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai)
        - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi)
    })
  const regularFlows = allFlows.filter((f) => !f.isSystem)

  return [...systemFlows, ...regularFlows].map(stripFlowTriggers)
})
