/**
 * 組織與 LINE 設定頁僅 owner / admin 可進入（與後端 line-workspace admin 對齊）。
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (!to.path.includes('/settings/organization')) return

  const wid = to.params.workspaceId as string | undefined
  if (!wid) return

  const { loadWorkspaceList, canManageSettings } = useWorkspace()
  await loadWorkspaceList().catch(() => {})

  if (!canManageSettings.value) {
    return navigateTo(`/admin/${wid}/conversations`, { replace: true })
  }
})
