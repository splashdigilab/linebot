/**
 * 後台共用：載入 Firestore 標籤列表（/api/tag/list）
 */
export function useAdminTagList() {
  const tags = ref<any[]>([])
  const loading = ref(false)

  async function loadTags(query?: { status?: string }): Promise<boolean> {
    loading.value = true
    try {
      const search = new URLSearchParams()
      if (query?.status) search.set('status', query.status)
      const qs = search.toString() ? `?${search.toString()}` : ''
      tags.value = await $fetch<any[]>(`/api/tag/list${qs}`)
      return true
    }
    catch {
      tags.value = []
      return false
    }
    finally {
      loading.value = false
    }
  }

  return { tags, loading, loadTags }
}
