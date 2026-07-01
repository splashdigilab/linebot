import { requireWorkspaceAccess } from '../utils/workspace-auth'

/**
 * 開發期閘門：AI 相關 API 暫時只開放 workspace admin（含 org admin / super admin）。
 *
 * 這是「整片 AI 先限 admin」的單一控制點——把進入門檻抬到 admin，蓋過各 endpoint
 * 原本較寬鬆的 requireCapability（例如知識/腳本只需 agent）。
 *
 * 之後要開放給 agent/viewer 時，直接刪除此檔即可：各 endpoint 的 requireCapability
 * （見 ~~/shared/permissions.ts）會自動接手，做細緻的 per-capability 把關。
 * 前端 AI 選單／頁面守衛（app/layouts/default.vue、app/middleware/ai-feature.ts）
 * 目前也同步只給 admin，開放時一併放寬。
 *
 * 注意：LINE webhook 的 AI 自動回覆走 server utils 內部呼叫（answerWithAi），
 * 不經過 /api/ai/*，因此不受此閘門影響。
 */
export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0] ?? ''

  const isAiApi = path.startsWith('/api/ai/')
    || (path.startsWith('/api/conversations/') && path.endsWith('/ai-context'))
  if (!isAiApi) return

  await requireWorkspaceAccess(event, 'admin')
})
