import { runDueScheduledBroadcasts } from '~~/server/utils/run-due-scheduled-broadcasts'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

/**
 * POST /api/broadcast/process-due
 *
 * 由後台登入者觸發：處理目前 workspace 內已到期的排程推播。
 * 推播列表頁會每分鐘自動呼叫，作為 Amplify 無長駐 Cron 時的備援。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  return await runDueScheduledBroadcasts({ workspaceId })
})
