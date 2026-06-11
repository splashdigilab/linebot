/**
 * AI 相關頁面暫時只開放 super admin。
 * 之後正式開放時，移除此 middleware 與各頁面 definePageMeta 的引用即可。
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { user, waitForAuthReady } = useAuth()
  await waitForAuthReady()
  if (!user.value) return navigateTo({ path: '/login', query: { redirect: to.fullPath } })

  const tokenResult = await user.value.getIdTokenResult()
  if (tokenResult.claims.superAdmin === true) return

  const wid = to.params.workspaceId
  return navigateTo(wid ? `/admin/${wid}` : '/admin/workspaces')
})
