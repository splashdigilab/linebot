import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { setAiSettings } from '~~/server/utils/ai-settings'

/**
 * PUT /api/ai/settings
 * Body: AiSettingsDoc 的 partial（任何欄位可省略）
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const body = await readBody(event)
  return setAiSettings(workspaceId, body ?? {})
})
