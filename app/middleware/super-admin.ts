export default defineNuxtRouteMiddleware(async (to) => {
  const { user, waitForAuthReady } = useAuth()
  await waitForAuthReady()
  if (!user.value) return navigateTo({ path: '/login', query: { redirect: to.fullPath } })

  const tokenResult = await user.value.getIdTokenResult()
  if (!tokenResult.claims.superAdmin) return navigateTo('/admin/workspaces')

  if (to.path === '/admin/super' || to.path === '/admin/super/') {
    return navigateTo('/admin/super/organizations', { replace: true })
  }
})
