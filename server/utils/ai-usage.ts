/**
 * AI 用量統計（aiUsage/{workspaceId}_{yyyyMM}）。
 *
 * - Doc ID: `{workspaceId}_{yyyyMM}`（top-level；workspaceId 一起入 ID 方便 list）
 * - 每次 AI 介入（呼叫 /api/ai/answer）都會 bump 一次
 * - 透過 Firestore 原子 increment 避免 race
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { getDb } from './firebase'
import type { AiUsageDoc } from '~~/shared/types/ai-knowledge'

export const AI_USAGE_COLLECTION = 'aiUsage'

export function currentYyyyMm(date = new Date()): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}${m}`
}

function usageDocId(workspaceId: string, yyyyMm: string): string {
  return `${workspaceId}_${yyyyMm}`
}

export interface UsageDelta {
  inputTokens?: number
  outputTokens?: number
  embeddingTokens?: number
  invocations?: number
  answered?: number
  handoffs?: number
  disambiguations?: number
}

/**
 * 把這次 AI 介入的用量原子加總到當月 doc。失敗只 log 不阻塞主流程。
 */
export async function recordAiUsage(
  workspaceId: string,
  delta: UsageDelta,
  db: Firestore = getDb(),
): Promise<void> {
  const yyyyMm = currentYyyyMm()
  const ref = db.collection(AI_USAGE_COLLECTION).doc(usageDocId(workspaceId, yyyyMm))
  const updates: Record<string, unknown> = {
    workspaceId,
    period: yyyyMm,
    updatedAt: FieldValue.serverTimestamp(),
  }
  if (delta.inputTokens) updates.inputTokens = FieldValue.increment(delta.inputTokens)
  if (delta.outputTokens) updates.outputTokens = FieldValue.increment(delta.outputTokens)
  if (delta.embeddingTokens) updates.embeddingTokens = FieldValue.increment(delta.embeddingTokens)
  if (delta.invocations) updates.invocations = FieldValue.increment(delta.invocations)
  if (delta.answered) updates.answered = FieldValue.increment(delta.answered)
  if (delta.handoffs) updates.handoffs = FieldValue.increment(delta.handoffs)
  if (delta.disambiguations) updates.disambiguations = FieldValue.increment(delta.disambiguations)

  try {
    await ref.set(updates, { merge: true })
  }
  catch (e) {
    console.error('[ai-usage] recordAiUsage failed:', e)
  }
}

/**
 * 取得本月已使用 token 總數（input + output + embedding）。
 * 給 quota 判斷用。
 */
export async function getCurrentMonthTokens(
  workspaceId: string,
  db: Firestore = getDb(),
): Promise<number> {
  const yyyyMm = currentYyyyMm()
  const ref = db.collection(AI_USAGE_COLLECTION).doc(usageDocId(workspaceId, yyyyMm))
  const snap = await ref.get()
  if (!snap.exists) return 0
  const data = snap.data() as Partial<AiUsageDoc>
  return Number(data?.inputTokens ?? 0) + Number(data?.outputTokens ?? 0) + Number(data?.embeddingTokens ?? 0)
}
