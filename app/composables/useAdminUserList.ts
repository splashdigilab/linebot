/**
 * 後台共用：載入會員列表（/api/users/list，伺服器分頁）
 */
export const ADMIN_USER_PAGE_SIZE = 50

export type AdminUserListQuery = {
  tagIds?: string[]
  search?: string
  page?: number
  limit?: number
}

export function useAdminUserList() {
  const users = ref<any[]>([])
  const loading = ref(false)
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(ADMIN_USER_PAGE_SIZE)
  const { apiFetch } = useWorkspace()

  let inFlight: { key: string; promise: Promise<boolean> } | null = null

  async function loadUsers(query?: AdminUserListQuery): Promise<boolean> {
    const key = JSON.stringify({
      tagIds: query?.tagIds ?? [],
      search: query?.search ?? '',
      page: query?.page ?? 1,
      limit: query?.limit ?? ADMIN_USER_PAGE_SIZE,
    })
    if (inFlight && inFlight.key === key) return inFlight.promise

    const task = (async () => {
      loading.value = true
      try {
        const search = new URLSearchParams()
        if (query?.tagIds?.length) search.set('tagIds', query.tagIds.join(','))
        if (query?.search?.trim()) search.set('search', query.search.trim())
        search.set('page', String(query?.page ?? 1))
        search.set('limit', String(query?.limit ?? pageSize.value))

        const res = await apiFetch<{
          users: any[]
          total: number
          page: number
          limit: number
        }>(`/api/users/list?${search.toString()}`)

        users.value = res.users ?? []
        total.value = res.total ?? 0
        page.value = res.page ?? query?.page ?? 1
        pageSize.value = res.limit ?? query?.limit ?? ADMIN_USER_PAGE_SIZE
        return true
      }
      catch {
        users.value = []
        total.value = 0
        return false
      }
      finally {
        loading.value = false
        inFlight = null
      }
    })()
    inFlight = { key, promise: task }
    return task
  }

  return { users, loading, total, page, pageSize, loadUsers }
}
