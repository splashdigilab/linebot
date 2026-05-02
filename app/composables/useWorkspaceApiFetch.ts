import type { MaybeRefOrGetter } from 'vue'
import { toValue } from 'vue'
import { DEFAULT_LINE_WORKSPACE_ID } from '~~/shared/line-workspace'

/**
 * 與 `useWorkspace().apiFetch` 相同：自動帶 Firebase Bearer + workspaceId（GET 用 query、POST 併入 body）。
 * 用於沒有 `/admin/:workspaceId` 路由參數的頁面（例如固定 `default` workspace）。
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
      return await $fetch(`${url}${sep}workspaceId=${encodeURIComponent(wid)}`, {
        ...options,
        headers: { ...authHeader, ...(options?.headers as object ?? {}) },
      }) as T
    }

    return await $fetch(url, {
      ...options,
      headers: { ...authHeader, ...(options?.headers as object ?? {}) },
      body: options?.body
        ? { ...(options.body as object), workspaceId: wid }
        : { workspaceId: wid },
    }) as T
  }

  return { apiFetch, getBearer }
}
