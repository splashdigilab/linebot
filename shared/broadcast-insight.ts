import { createHash } from 'node:crypto'

/**
 * LINE multicast 自訂彙總單位名稱（customAggregationUnits）。
 * LINE 限制長度 **1～30** 字元；以 campaignId 雜湊成固定長度，同一推播可查 insight。
 */
export function broadcastAggregationUnit(campaignId: string): string {
  const h = createHash('sha256')
    .update(`line-broadcast-unit:${String(campaignId || '')}`)
    .digest('hex')
    .slice(0, 28)
  return `bc${h}` // 2 + 28 = 30
}
