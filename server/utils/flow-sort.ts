/** 將 Firestore createdAt 轉成毫秒（供排序用） */
export function flowCreatedAtMillis(ts: unknown): number {
  if (!ts) return 0
  if (typeof ts === 'object' && ts !== null && 'toMillis' in ts) {
    const toMillis = (ts as { toMillis?: () => number }).toMillis
    if (typeof toMillis === 'function') return toMillis.call(ts)
  }
  if (ts instanceof Date) return ts.getTime()
  return 0
}

/** 越小越靠前；未設定 sortOrder 時沿用 createdAt 新→舊 */
export function resolveFlowSortOrder(flow: Record<string, unknown>): number {
  const raw = flow.sortOrder
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const ms = flowCreatedAtMillis(flow.createdAt)
  return ms > 0 ? -ms : 0
}

export function sortRegularFlows<T extends Record<string, unknown>>(flows: T[]): T[] {
  return [...flows].sort((a, b) => resolveFlowSortOrder(a) - resolveFlowSortOrder(b))
}

export function nextFlowSortOrder(regularFlows: Record<string, unknown>[]): number {
  if (!regularFlows.length) return 0
  const min = Math.min(...regularFlows.map(resolveFlowSortOrder))
  return min - 1
}
