/**
 * 觀察者（viewer）僅能檢視；營運寫入需 canOperate（客服以上）。
 */
export function useAdminOperateGuard() {
  const { canOperate } = useWorkspace()
  const { showToast } = useAdminToast()

  function guardOperate<T>(fn: () => T): T | undefined {
    if (!canOperate.value) {
      showToast('觀察者無法執行此操作', 'warning')
      return undefined
    }
    return fn()
  }

  function assertCanOperate(): boolean {
    if (!canOperate.value) {
      showToast('觀察者無法執行此操作', 'warning')
      return false
    }
    return true
  }

  return { canOperate, guardOperate, assertCanOperate }
}
