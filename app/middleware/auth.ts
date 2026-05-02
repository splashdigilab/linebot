export default defineNuxtRouteMiddleware((to) => {
  if (!to.path.startsWith('/admin')) return

  const { isLoggedIn, loading } = useAuth()
  if (loading.value) return

  if (!isLoggedIn.value) {
    return navigateTo('/login')
  }

  // 在 /admin（無 workspaceId）時，導向 workspace 選擇頁
  const workspaceId = to.params.workspaceId as string | undefined
  if (!workspaceId && to.path !== '/admin/workspaces') {
    return navigateTo('/admin/workspaces')
  }
})
