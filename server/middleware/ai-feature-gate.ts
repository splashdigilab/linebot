import { requireSuperAdmin } from '../utils/workspace-auth'

/**
 * AI 相關 API 暫時只開放 super admin。
 * 之後正式開放時，刪除此檔即可恢復各 endpoint 原本的 workspace 權限檢查。
 *
 * 注意：LINE webhook 的 AI 自動回覆走 server utils 內部呼叫（answerWithAi），
 * 不經過 /api/ai/*，因此不受此閘門影響。
 */
export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0] ?? ''

  const isAiApi = path.startsWith('/api/ai/')
    || (path.startsWith('/api/conversations/') && path.endsWith('/ai-context'))
  if (!isAiApi) return

  await requireSuperAdmin(event)
})
