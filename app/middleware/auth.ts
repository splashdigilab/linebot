export default defineNuxtRouteMiddleware((to) => {
  if (!to.path.startsWith('/admin')) return

  const { isLoggedIn, loading } = useAuth()
  if (loading.value) return

  if (!isLoggedIn.value) {
    return navigateTo('/login')
  }

  // 在 /admin（無 workspaceId）時，導向 workspace 選擇頁
  // /admin/super/* 交給 super-admin middleware 自行處理
  const workspaceId = to.params.workspaceId as string | undefined
  if (!workspaceId && to.path !== '/admin/workspaces' && !to.path.startsWith('/admin/super')) {
    return navigateTo('/admin/workspaces')
  }
})
