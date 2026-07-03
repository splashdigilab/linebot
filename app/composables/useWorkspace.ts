import type { WorkspaceMemberRole } from '~~/shared/types/organization'
import type { Capability } from '~~/shared/permissions'
import { can as canWithRole } from '~~/shared/permissions'
import { useWorkspaceApiFetch } from './useWorkspaceApiFetch'

export interface WorkspaceItem {
  workspaceId: string
  name: string
  role: WorkspaceMemberRole
  organizationId: string | null
  organizationName: string | null
  /** 精簡方案標籤（僅 owner/admin 角色、且已訂閱時由後端帶出，供帳號選單顯示）。 */
  plan?: { id: string; name: string } | null
}

interface OrgAdminEntry { id: string; name: string }

interface MyWorkspacesResponse {
  workspaces: WorkspaceItem[]
  orgAdminOf: OrgAdminEntry[]
}

/**
 * 提供目前作用中的 workspace 上下文，以及自動注入 auth token + workspaceId 的 fetch 工具。
 * workspaceId 來自路由參數 /admin/[workspaceId]/...
 */
export const useWorkspace = () => {
  const route = useRoute()

  const workspaceId = computed(() => route.params.workspaceId as string)

  const workspaceList = useState<WorkspaceItem[]>('workspace:list', () => [])
  const orgAdminOf = useState<OrgAdminEntry[]>('workspace:orgAdminOf', () => [])
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
  // in-flight dedup：避免 layout + page 同時 onMounted 並行打 `/api/admin/workspaces/my`
  // 模組級單例：所有元件共用同一個進行中的 Promise
  const inFlight = useState<Promise<WorkspaceItem[]> | null>('workspace:loadInFlight', () => null)

  async function loadWorkspaceList(): Promise<WorkspaceItem[]> {
    if (inFlight.value) return inFlight.value
    const task = (async () => {
      try {
        const token = await getBearer()
        const res = await $fetch<MyWorkspacesResponse>('/api/admin/workspaces/my', {
          headers: { Authorization: `Bearer ${token}` },
        })
        workspaceList.value = res.workspaces
        orgAdminOf.value = res.orgAdminOf
        return res.workspaces
      }
      finally {
        inFlight.value = null
      }
    })()
    inFlight.value = task
    return task
  }

  // ── Role check helpers ─────────────────────────────────────────
  // canManageSettings：成員、LINE 憑證等 workspace 設定
  // canOperate：客服營運（對話、模組、推播等）— 不含觀察者
  // canWrite：同 canManageSettings（保留舊名稱相容）

  const canManageSettings = computed(() => {
    const r = currentRole.value
    return r === 'owner' || r === 'admin'
  })

  const canOperate = computed(() => {
    const r = currentRole.value
    return r === 'owner' || r === 'admin' || r === 'agent'
  })

  const isViewer = computed(() => currentRole.value === 'viewer')

  const canWrite = canManageSettings

  const isOwner = computed(() => currentRole.value === 'owner')

  // 能力判斷：讀 ~~/shared/permissions.ts 的 CAPABILITIES，與後端 requireCapability 同一份表。
  // 用法：can('scripts.write')、can('ai.settings.write') …
  const can = (capability: Capability) => canWithRole(currentRole.value, capability)

  return {
    workspaceId,
    currentRole,
    currentWorkspaceName,
    workspaceList,
    orgAdminOf,
    canManageSettings,
    canOperate,
    isViewer,
    canWrite,
    isOwner,
    can,
    getBearer,
    apiFetch,
    loadWorkspaceList,
  }
}
