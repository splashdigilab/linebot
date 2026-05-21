import { ADMIN_SIDEBAR_PAGE_SIZE } from '~~/app/composables/useAdminSidebarInfiniteList'

export type FlowModulePickerOption = {
  id: string
  name: string
}

/**
 * 機器人模組頁：一次載入完整清單，側邊欄客戶端分頁、選單共用同一份資料（避免重複打 list API）。
 */
export function useFlowWorkspaceList() {
  const { apiFetch } = useWorkspace()
  const allFlows = ref<any[]>([])
  const visibleRegularCount = ref(ADMIN_SIDEBAR_PAGE_SIZE)
  const loading = ref(false)
  const loadingMore = ref(false)
  const listEl = ref<HTMLElement | null>(null)

  const systemFlowsAll = computed(() => allFlows.value.filter((f) => f.isSystem))
  const regularFlowsAll = computed(() => allFlows.value.filter((f) => !f.isSystem))

  const flows = computed(() => [
    ...systemFlowsAll.value,
    ...regularFlowsAll.value.slice(0, visibleRegularCount.value),
  ])

  const hasMore = computed(() => regularFlowsAll.value.length > visibleRegularCount.value)

  const modulePickerOptions = computed<FlowModulePickerOption[]>(() =>
    allFlows.value.map(f => ({
      id: f.id,
      name: String(f.name || f.id),
    })),
  )

  function resetVisibleRegularCount() {
    const systemCount = systemFlowsAll.value.length
    visibleRegularCount.value = Math.max(0, ADMIN_SIDEBAR_PAGE_SIZE - systemCount)
  }

  async function prefetchIfListDoesNotScroll() {
    await nextTick()
    const el = listEl.value
    if (!el || !hasMore.value || loading.value || loadingMore.value) return
    if (el.scrollHeight <= el.clientHeight + 1) {
      await loadMore()
      await prefetchIfListDoesNotScroll()
    }
  }

  async function load(reset = true) {
    if (reset) {
      if (loading.value) return
      loading.value = true
    }
    else {
      if (loadingMore.value || loading.value || !hasMore.value) return
      loadingMore.value = true
    }

    try {
      if (reset) {
        allFlows.value = await apiFetch<any[]>('/api/flow/list').catch(() => [])
        resetVisibleRegularCount()
        if (hasMore.value) await prefetchIfListDoesNotScroll()
      }
      else {
        visibleRegularCount.value += ADMIN_SIDEBAR_PAGE_SIZE
        if (hasMore.value) await prefetchIfListDoesNotScroll()
      }
    }
    catch {
      if (reset) allFlows.value = []
    }
    finally {
      loading.value = false
      loadingMore.value = false
    }
  }

  async function loadMore() {
    if (!hasMore.value || loading.value || loadingMore.value) return
    await load(false)
  }

  function onScroll() {
    const el = listEl.value
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80)
      void loadMore()
  }

  function setRegularFlowsOrder(nextRegular: any[]) {
    allFlows.value = [...systemFlowsAll.value, ...nextRegular]
  }

  return {
    allFlows,
    flows,
    modulePickerOptions,
    loading,
    loadingMore,
    hasMore,
    listEl,
    load,
    loadMore,
    onScroll,
    setRegularFlowsOrder,
  }
}
