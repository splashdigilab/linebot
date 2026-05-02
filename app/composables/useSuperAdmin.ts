/**
 * Super admin 頁面專用 composable：提供 apiFetch（自動帶 Bearer token）
 * 以及 isSuperAdmin 狀態。
 */
export const useSuperAdmin = () => {
  const { $auth } = useNuxtApp()

  async function getBearer(): Promise<string> {
    const u = $auth.currentUser
    if (!u) {
      await navigateTo('/login')
      throw new Error('not logged in')
    }
    return u.getIdToken()
  }

  async function apiFetch<T>(
    url: string,
    options?: Parameters<typeof $fetch>[1],
  ): Promise<T> {
    const token = await getBearer()
    return $fetch<T>(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options?.headers as object ?? {}),
      },
    })
  }

  const isSuperAdmin = useState<boolean>('superadmin:flag', () => false)

  async function checkIsSuperAdmin(): Promise<boolean> {
    const u = $auth.currentUser
    if (!u) return false
    const result = await u.getIdTokenResult()
    isSuperAdmin.value = result.claims.superAdmin === true
    return isSuperAdmin.value
  }

  return { apiFetch, getBearer, isSuperAdmin, checkIsSuperAdmin }
}
