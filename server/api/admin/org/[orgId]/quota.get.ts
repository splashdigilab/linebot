import { requireOrgAdmin } from '~~/server/utils/workspace-auth'
import { getWorkspaceQuota } from '~~/server/utils/workspace-quota'

/**
 * GET /api/admin/org/:orgId/quota
 * 查詢該組織的 workspace 使用量與上限。
 * 需為 org admin 或 super admin。
 */
export default defineEventHandler(async (event) => {
  const orgId = event.context.params?.orgId
  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'orgId is required' })

  await requireOrgAdmin(event, orgId)

  return getWorkspaceQuota(orgId)
})
