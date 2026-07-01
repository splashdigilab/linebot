/**
 * 設定頁（成員管理、組織與 LINE）僅 owner / admin 可進入，
 * 與後端 members.manage / line.manage（皆 admin）對齊；直接輸入網址也擋。
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (!to.path.includes('/settings/')) return

  const wid = to.params.workspaceId as string | undefined
  if (!wid) return

  const { loadWorkspaceList, canManageSettings } = useWorkspace()
  await loadWorkspaceList().catch(() => {})

  if (!canManageSettings.value) {
    return navigateTo(`/admin/${wid}/conversations`, { replace: true })
  }
})
