import { getDoc } from '~~/server/utils/firebase'
import { SYSTEM_MODULE_IDS } from '~~/shared/types/conversation-stats'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

function stripFlowTriggers(flow: Record<string, unknown>) {
  const { triggers, trigger, ...rest } = flow
  return rest
}

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  const workspaceFlows = await listDocs('flows', (ref) =>
    ref.where('workspaceId', '==', workspaceId).orderBy('createdAt', 'desc'),
  )

  // 系統模組（歡迎／真人）為全站共用文件，沒有 workspaceId；仍應出現在目前 workspace 的流程列表
  const systemIds = [SYSTEM_MODULE_IDS.welcome, SYSTEM_MODULE_IDS.live_agent] as const
  const systemFlows: Record<string, unknown>[] = []
  for (const sid of systemIds) {
    const doc = await getDoc('flows', sid)
    if (doc) systemFlows.push(stripFlowTriggers(doc as Record<string, unknown>))
  }

  const systemIdSet = new Set(systemFlows.map(f => f.id as string))
  const merged = [
    ...systemFlows,
    ...workspaceFlows
      .filter((f: { id: string }) => !systemIdSet.has(f.id))
      .map((flow: Record<string, unknown>) => stripFlowTriggers(flow)),
  ]

  return merged
})
