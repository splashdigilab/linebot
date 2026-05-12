/**
 * 後台共用：載入會員列表（/api/users/list）
 */
export function useAdminUserList() {
  const users = ref<any[]>([])
  const loading = ref(false)
  const { apiFetch } = useWorkspace()

  // in-flight dedup：相同 query 並行呼叫只發 1 次
  let inFlight: { key: string; promise: Promise<boolean> } | null = null

  async function loadUsers(query?: { tagIds?: string[]; limit?: number }): Promise<boolean> {
    const key = JSON.stringify({ tagIds: query?.tagIds ?? [], limit: query?.limit ?? 500 })
    if (inFlight && inFlight.key === key) return inFlight.promise

    const task = (async () => {
      loading.value = true
      try {
        const search = new URLSearchParams()
        if (query?.tagIds?.length) search.set('tagIds', query.tagIds.join(','))
        search.set('limit', String(query?.limit ?? 500))
        const qs = search.toString() ? `?${search.toString()}` : ''
        const res = await apiFetch<{ users: any[] }>(`/api/users/list${qs}`)
        users.value = res.users ?? []
        return true
      }
      catch {
        users.value = []
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

  return { users, loading, loadUsers }
}
