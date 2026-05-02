import type { WorkspaceMemberRole } from '~~/shared/types/organization'

export interface WorkspaceItem {
  workspaceId: string
  name: string
  role: WorkspaceMemberRole
  organizationId: string | null
}

/**
 * 提供目前作用中的 workspace 上下文，以及自動注入 auth token + workspaceId 的 fetch 工具。
 * workspaceId 來自路由參數 /admin/[workspaceId]/...
 */
export const useWorkspace = () => {
  const route = useRoute()
  const { $auth } = useNuxtApp()

  const workspaceId = computed(() => route.params.workspaceId as string)

  const workspaceList = useState<WorkspaceItem[]>('workspace:list', () => [])
  const currentRole = computed<WorkspaceMemberRole | null>(() => {
    const found = workspaceList.value.find(w => w.workspaceId === workspaceId.value)
    return found?.role ?? null
  })
  const currentWorkspaceName = computed(() => {
    const found = workspaceList.value.find(w => w.workspaceId === workspaceId.value)
    return found?.name ?? workspaceId.value
  })

  // ── Auth helpers ───────────────────────────────────────────────

  async function getBearer(): Promise<string> {
    const u = $auth.currentUser
    if (!u) {
      await navigateTo('/login')
      throw new Error('not logged in')
    }
    return u.getIdToken()
  }

  // ── Workspace-aware fetch ──────────────────────────────────────

  async function apiFetch<T>(
    url: string,
    options?: Parameters<typeof $fetch>[1],
  ): Promise<T> {
    const token = await getBearer()
    const method = ((options?.method as string) ?? 'GET').toUpperCase()
    const wid = workspaceId.value
    const authHeader = { Authorization: `Bearer ${token}` }

    if (method === 'GET' || method === 'HEAD' || method === 'DELETE') {
      const sep = url.includes('?') ? '&' : '?'
      return $fetch<T>(`${url}${sep}workspaceId=${wid}`, {
        ...options,
        headers: { ...authHeader, ...(options?.headers as object ?? {}) },
      })
    }

    return $fetch<T>(url, {
      ...options,
      headers: { ...authHeader, ...(options?.headers as object ?? {}) },
      body: options?.body
        ? { ...(options.body as object), workspaceId: wid }
        : { workspaceId: wid },
    })
  }

  // ── Load workspace list ────────────────────────────────────────

  async function loadWorkspaceList(): Promise<WorkspaceItem[]> {
    const token = await getBearer()
    const list = await $fetch<WorkspaceItem[]>('/api/admin/workspaces/my', {
      headers: { Authorization: `Bearer ${token}` },
    })
    workspaceList.value = list
    return list
  }

  // ── Role check helpers ─────────────────────────────────────────

  const canWrite = computed(() => {
    const r = currentRole.value
    return r === 'owner' || r === 'admin'
  })

  const isOwner = computed(() => currentRole.value === 'owner')

  return {
    workspaceId,
    currentRole,
    currentWorkspaceName,
    workspaceList,
    canWrite,
    isOwner,
    getBearer,
    apiFetch,
    loadWorkspaceList,
  }
}
