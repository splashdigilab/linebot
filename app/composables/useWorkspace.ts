import type { WorkspaceMemberRole } from '~~/shared/types/organization'
import { useWorkspaceApiFetch } from './useWorkspaceApiFetch'

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

  const { apiFetch, getBearer } = useWorkspaceApiFetch(() => workspaceId.value)

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
