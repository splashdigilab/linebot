export default defineNuxtRouteMiddleware((to) => {
  // Only protect /admin routes
  if (!to.path.startsWith('/admin')) return

  const { isLoggedIn, loading } = useAuth()

  // If still loading auth state, let it pass (page will handle)
  if (loading.value) return

  if (!isLoggedIn.value) {
    return navigateTo('/login')
  }
})
