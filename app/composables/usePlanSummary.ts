import { derivePlanState, type PlanView } from '~~/shared/billing/plan-state'
import { useWorkspace } from './useWorkspace'

interface PlanSummaryResponse {
  period: string
  plan: PlanView | null
  answered: number
}

/**
 * 抓「目前方案 + 本月已用則數」並導出額度使用狀態，供設定頁等處顯示精簡方案卡。
 * 與用量監控頁共用 derivePlanState（單一事實來源）；資料走輕量的 plan-summary 端點。
 */
export function usePlanSummary() {
  const { apiFetch } = useWorkspace()

  const plan = ref<PlanView | null>(null)
  const answered = ref(0)
  const loading = ref(false)
  const loaded = ref(false)

  const state = computed(() => derivePlanState(plan.value, answered.value))

  async function load() {
    loading.value = true
    try {
      const res = await apiFetch<PlanSummaryResponse>('/api/ai/usage/plan-summary')
      plan.value = res.plan
      answered.value = res.answered ?? 0
    }
    catch {
      plan.value = null
      answered.value = 0
    }
    finally {
      loading.value = false
      loaded.value = true
    }
  }

  return { plan, answered, state, loading, loaded, load }
}
