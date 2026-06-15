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

  // 泛用 string URL 的轉送層:不要走 nitro typed routes 的 $fetch 推導
  // (路由聯集太大,TS 比對 string 會爆 "Excessive stack depth");型別安全由呼叫端 <T> 提供
  const rawFetch = $fetch as (url: string, opts?: Record<string, unknown>) => Promise<unknown>

  async function apiFetch<T>(
    url: string,
    options?: Parameters<typeof $fetch>[1],
  ): Promise<T> {
    const token = await getBearer()
    return await rawFetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options?.headers as object ?? {}),
      },
    }) as T
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
