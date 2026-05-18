import { getDb } from '~~/server/utils/firebase'
import { seedWorkspaceSystemModules } from '~~/server/utils/workspace-system-modules'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  const results = await seedWorkspaceSystemModules(getDb(), workspaceId)
  return { ok: true, results }
})
