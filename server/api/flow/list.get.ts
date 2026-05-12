import { getDb } from '~~/server/utils/firebase'
import { seedWorkspaceSystemModules } from '~~/server/utils/workspace-system-modules'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

function stripFlowTriggers(flow: Record<string, unknown>) {
  const { triggers, trigger, ...rest } = flow
  return rest
}

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')

  // Auto-create system modules if missing (transparent fix for all existing workspaces)
  await seedWorkspaceSystemModules(getDb(), workspaceId)

  const allFlows = await listDocs('flows', (ref) =>
    ref.where('workspaceId', '==', workspaceId).orderBy('createdAt', 'asc'),
  )

  // System modules first, then regular flows (newest first)
  const systemFlows = allFlows.filter((f: Record<string, unknown>) => f.isSystem)
  const regularFlows = allFlows.filter((f: Record<string, unknown>) => !f.isSystem).reverse()

  return [...systemFlows, ...regularFlows].map((flow: Record<string, unknown>) =>
    stripFlowTriggers(flow),
  )
})
