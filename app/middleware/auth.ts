function workspaceIdFromAdminPath(path: string): string | undefined {
  const segments = path.split('/').filter(Boolean)
  if (segments[0] !== 'admin' || !segments[1]) return undefined
  // 這些是「不綁 workspace」的 admin 頁，segments[1] 不是 workspaceId
  if (segments[1] === 'workspaces' || segments[1] === 'super' || segments[1] === 'onboarding') return undefined
  return segments[1]
}

export default defineNuxtRouteMiddleware(async (to) => {
  if (!to.path.startsWith('/admin')) return

  const { isLoggedIn, waitForAuthReady } = useAuth()
  await waitForAuthReady()

  if (!isLoggedIn.value) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }

  // 在 /admin（無 workspaceId）時，導向 workspace 選擇頁
  // /admin/super/* 交給 super-admin middleware 自行處理
  const workspaceId = (to.params.workspaceId as string | undefined)
    ?? workspaceIdFromAdminPath(to.path)
  if (
    !workspaceId
    && to.path !== '/admin/workspaces'
    && to.path !== '/admin/onboarding'
    && !to.path.startsWith('/admin/super')
  ) {
    return navigateTo('/admin/workspaces')
  }
})
