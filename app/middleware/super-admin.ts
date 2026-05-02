export default defineNuxtRouteMiddleware(async (to) => {
  const { $auth } = useNuxtApp()
  const user = $auth.currentUser
  if (!user) return navigateTo('/login')

  const tokenResult = await user.getIdTokenResult()
  if (!tokenResult.claims.superAdmin) return navigateTo('/admin/workspaces')

  if (to.path === '/admin/super' || to.path === '/admin/super/') {
    return navigateTo('/admin/super/organizations', { replace: true })
  }
})
