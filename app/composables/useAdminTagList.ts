/**
 * 後台共用：載入 Firestore 標籤列表（/api/tag/list）
 *
 * 重要：`loadTags` 只接受 `query` 物件，不要傳 workspaceId（已由 useWorkspace.apiFetch 自動帶入）。
 *   ✓ loadTags({ status: 'active' })
 *   ✗ loadTags(workspaceId.value, { status: 'active' })  // 第一個參數會被吃掉導致 status filter 失效
 */
export const ADMIN_TAG_PAGE_SIZE = 50

export type AdminTagListQuery = {
  status?: string
  category?: string
  search?: string
  includeMemberCount?: boolean
  page?: number
  limit?: number
}

export function useAdminTagList() {
  const tags = ref<any[]>([])
  const loading = ref(false)
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(ADMIN_TAG_PAGE_SIZE)
  const { apiFetch } = useWorkspace()

  let inFlight: { key: string; promise: Promise<boolean> } | null = null

  async function loadTags(query?: AdminTagListQuery): Promise<boolean> {
    const key = JSON.stringify({
      status: query?.status ?? '',
      category: query?.category ?? '',
      search: query?.search ?? '',
      includeMemberCount: query?.includeMemberCount ? '1' : '0',
      page: query?.page ?? '',
      limit: query?.limit ?? '',
    })
    if (inFlight && inFlight.key === key) return inFlight.promise

    const task = (async () => {
      loading.value = true
      try {
        const search = new URLSearchParams()
        if (query?.status) search.set('status', query.status)
        if (query?.category) search.set('category', query.category)
        if (query?.search?.trim()) search.set('search', query.search.trim())
        if (query?.includeMemberCount) search.set('includeMemberCount', '1')
        if (query?.page) {
          search.set('page', String(query.page))
          search.set('limit', String(query.limit ?? pageSize.value))
        }

        const qs = search.toString() ? `?${search.toString()}` : ''
        const res = await apiFetch<any>(`/api/tag/list${qs}`)

        if (query?.page) {
          tags.value = res.items ?? []
          total.value = res.total ?? 0
          page.value = res.page ?? query.page
          pageSize.value = res.limit ?? query.limit ?? ADMIN_TAG_PAGE_SIZE
        }
        else {
          tags.value = Array.isArray(res) ? res : (res.items ?? [])
          total.value = tags.value.length
        }
        return true
      }
      catch {
        tags.value = []
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

  return { tags, loading, total, page, pageSize, loadTags }
}
