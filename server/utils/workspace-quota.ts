import { PLAN_WORKSPACE_QUOTA } from '~~/shared/types/organization'
import type { OrganizationPlan } from '~~/shared/types/organization'
import { getDb } from './firebase'

export interface WorkspaceQuotaInfo {
  plan: OrganizationPlan
  limit: number
  used: number
  remaining: number
}

/**
 * 查詢該組織目前的 workspace 使用量與上限。
 * orgId 不存在時視為無限制（super admin 直接建立未歸屬組織的 workspace）。
 */
export async function getWorkspaceQuota(orgId: string): Promise<WorkspaceQuotaInfo> {
  const db = getDb()

  const [orgSnap, wsSnap] = await Promise.all([
    db.collection('organizations').doc(orgId).get(),
    db.collection('workspaces').where('organizationId', '==', orgId).get(),
  ])

  if (!orgSnap.exists) {
    throw createError({ statusCode: 404, statusMessage: '找不到此組織' })
  }

  const plan = (orgSnap.data()!.plan ?? 'free') as OrganizationPlan
  const limit = PLAN_WORKSPACE_QUOTA[plan]
  const used = wsSnap.size

  return { plan, limit, used, remaining: limit === Infinity ? Infinity : limit - used }
}

/**
 * 若該組織已達 workspace 上限則拋出 403。
 * 用於建立 workspace 前的前置檢查。
 */
export async function requireWorkspaceQuota(orgId: string): Promise<WorkspaceQuotaInfo> {
  const quota = await getWorkspaceQuota(orgId)

  if (quota.used >= quota.limit) {
    throw createError({
      statusCode: 403,
      statusMessage: `此組織（${quota.plan} 方案）已達官方帳號上限 ${quota.limit} 個，請升級方案後再新增。`,
    })
  }

  return quota
}
