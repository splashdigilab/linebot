import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { getAiSettings } from '~~/server/utils/ai-settings'

/**
 * GET /api/ai/settings
 * 回傳當前工作區的 AI 設定（不存在則回預設值）。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'viewer')
  return getAiSettings(workspaceId)
})
