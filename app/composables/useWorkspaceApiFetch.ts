import type { MaybeRefOrGetter } from 'vue'
import { toValue } from 'vue'
import { DEFAULT_LINE_WORKSPACE_ID } from '~~/shared/line-workspace'

/**
 * 與 `useWorkspace().apiFetch` 相同：自動帶 Firebase Bearer + workspaceId（GET 用 query、POST 併入 body）。
 * `workspaceId` 一般由 `useWorkspace()` 從 `/admin/:workspaceId` 路由傳入；預設值僅供可選參數使用。
 */
export function useWorkspaceApiFetch(workspaceId: MaybeRefOrGetter<string> = DEFAULT_LINE_WORKSPACE_ID) {
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
    const method = ((options?.method as string) ?? 'GET').toUpperCase()
    const wid = toValue(workspaceId)
    const authHeader = { Authorization: `Bearer ${token}` }

    if (method === 'GET' || method === 'HEAD' || method === 'DELETE') {
      const sep = url.includes('?') ? '&' : '?'
      return await rawFetch(`${url}${sep}workspaceId=${encodeURIComponent(wid)}`, {
        ...options,
        headers: { ...authHeader, ...(options?.headers as object ?? {}) },
      }) as T
    }

    return await rawFetch(url, {
      ...options,
      headers: { ...authHeader, ...(options?.headers as object ?? {}) },
      body: options?.body
        ? { ...(options.body as object), workspaceId: wid }
        : { workspaceId: wid },
    }) as T
  }

  return { apiFetch, getBearer }
}
