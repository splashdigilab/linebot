/**
 * AI 相關頁面的進入守門。
 *
 * 開發期：整片 AI 暫時只給 admin+（與後端 server/middleware/ai-feature-gate.ts 一致）。
 * 未來開放給 agent/viewer 時，把角色判斷放寬即可（改回只擋未登入，讓各 API 的
 * requireCapability 做細緻把關）。
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { user, waitForAuthReady } = useAuth()
  await waitForAuthReady()
  if (!user.value) return navigateTo({ path: '/login', query: { redirect: to.fullPath } })

  const wid = to.params.workspaceId as string | undefined
  if (!wid) return

  const { loadWorkspaceList, canManageSettings } = useWorkspace()
  await loadWorkspaceList().catch(() => {})
  if (!canManageSettings.value) {
    return navigateTo(`/admin/${wid}/conversations`, { replace: true })
  }
})
