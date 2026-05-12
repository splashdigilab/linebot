/**
 * 後台共用：載入 Firestore 標籤列表（/api/tag/list）
 *
 * 重要：`loadTags` 只接受 `query` 物件，不要傳 workspaceId（已由 useWorkspace.apiFetch 自動帶入）。
 *   ✓ loadTags({ status: 'active' })
 *   ✗ loadTags(workspaceId.value, { status: 'active' })  // 第一個參數會被吃掉導致 status filter 失效
 */
export function useAdminTagList() {
  const tags = ref<any[]>([])
  const loading = ref(false)
  const { apiFetch } = useWorkspace()

  // in-flight dedup：相同 query 並行呼叫只發 1 次
  let inFlight: { key: string; promise: Promise<boolean> } | null = null

  async function loadTags(query?: { status?: string }): Promise<boolean> {
    const key = query?.status ?? ''
    if (inFlight && inFlight.key === key) return inFlight.promise

    const task = (async () => {
      loading.value = true
      try {
        const search = new URLSearchParams()
        if (query?.status) search.set('status', query.status)
        const qs = search.toString() ? `?${search.toString()}` : ''
        tags.value = await apiFetch<any[]>(`/api/tag/list${qs}`)
        return true
      }
      catch {
        tags.value = []
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

  return { tags, loading, loadTags }
}
