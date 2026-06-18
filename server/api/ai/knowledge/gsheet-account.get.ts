import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { getServiceAccountEmail } from '~~/server/utils/google-sheets'

/**
 * GET /api/ai/knowledge/gsheet-account
 * 回傳本部署讀 Google Sheet 用的服務帳號 email，給匯入畫面提示
 * 「請把表單分享給這個帳號（檢視權限）」。
 */
export default defineEventHandler(async (event) => {
  await requireWorkspaceAccess(event, 'agent')
  return { serviceAccountEmail: getServiceAccountEmail() }
})
