/**
 * 後台 split sidebar 無限捲動列表（初次載入一批，捲到底再載入下一批）
 */
export const ADMIN_SIDEBAR_PAGE_SIZE = 30

export type SidebarListPageResult<T> = {
  items: T[]
  hasMore: boolean
}

type FetchPageFn<T> = (params: { page: number, limit: number }) => Promise<T[] | SidebarListPageResult<T>>

function normalizePageResult<T>(res: T[] | SidebarListPageResult<T>): SidebarListPageResult<T> {
  if (Array.isArray(res)) return { items: res, hasMore: false }
  return { items: res.items ?? [], hasMore: Boolean(res.hasMore) }
}

/** 標準後台 list API（有 page 回 { items, hasMore }；無 page 回陣列） */
export function useWorkspaceSidebarList<T>(
  path: string,
  params?: () => Record<string, unknown>,
) {
  const { apiFetch } = useWorkspace()
  return useAdminSidebarInfiniteList<T>(async ({ page, limit }) => {
    const res = await apiFetch<T[] | { items?: T[], hasMore?: boolean }>(path, {
      params: { page, limit, ...params?.() },
    })
    return normalizePageResult(res)
  })
}

export function useAdminSidebarInfiniteList<T>(fetchPage: FetchPageFn<T>) {
  const items = ref<T[]>([]) as Ref<T[]>
  const loading = ref(false)
  const loadingMore = ref(false)
  const hasMore = ref(false)
  const page = ref(1)
  const listEl = ref<HTMLElement | null>(null)

  async function load(reset = true) {
    if (reset) {
      if (loading.value) return
      loading.value = true
      page.value = 1
      hasMore.value = false
      items.value = []
    }
    else {
      if (loadingMore.value || loading.value || !hasMore.value) return
      loadingMore.value = true
    }

    try {
      const res = normalizePageResult(
        await fetchPage({ page: page.value, limit: ADMIN_SIDEBAR_PAGE_SIZE }),
      )
      items.value = reset ? res.items : [...items.value, ...res.items]
      hasMore.value = res.hasMore
    }
    catch {
      if (reset) items.value = []
      hasMore.value = false
    }
    finally {
      loading.value = false
      loadingMore.value = false
    }
  }

  async function loadMore() {
    if (!hasMore.value || loading.value || loadingMore.value) return
    page.value += 1
    await load(false)
  }

  function onScroll() {
    const el = listEl.value
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80)
      void loadMore()
  }

  return {
    items,
    loading,
    loadingMore,
    hasMore,
    listEl,
    load,
    loadMore,
    onScroll,
  }
}
