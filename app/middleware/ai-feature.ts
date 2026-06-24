/**
 * AI 相關頁面的進入守門。
 * 已開放給所有已登入的工作區成員——僅擋未登入；編輯/異動權限改由各 API 的
 * requireWorkspaceAccess 把關（例如腳本建立/修改需 admin、列表需 viewer）。
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { user, waitForAuthReady } = useAuth()
  await waitForAuthReady()
  if (!user.value) return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
})
