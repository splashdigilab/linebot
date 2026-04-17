/**
 * 後台共用：載入會員列表（/api/users/list）
 */
export function useAdminUserList() {
  const users = ref<any[]>([])
  const loading = ref(false)

  async function loadUsers(query?: { tagIds?: string[]; limit?: number }): Promise<boolean> {
    loading.value = true
    try {
      const search = new URLSearchParams()
      if (query?.tagIds?.length) search.set('tagIds', query.tagIds.join(','))
      if (query?.limit) search.set('limit', String(query.limit))
      const qs = search.toString() ? `?${search.toString()}` : ''
      const res = await $fetch<{ users: any[] }>(`/api/users/list${qs}`)
      users.value = res.users ?? []
      return true
    }
    catch {
      users.value = []
      return false
    }
    finally {
      loading.value = false
    }
  }

  return { users, loading, loadUsers }
}
