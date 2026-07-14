/**
 * AI 用量統計（aiUsage/{workspaceId}_{yyyyMM}）。
 *
 * - Doc ID: `{workspaceId}_{yyyyMM}`（top-level；workspaceId 一起入 ID 方便 list）
 * - 每次 AI 介入（呼叫 /api/ai/answer）都會 bump 一次
 * - 透過 Firestore 原子 increment 避免 race
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { getDb } from './firebase'
import { taipeiYyyyMm } from '~~/shared/time'
import type { AiUsageDoc } from '~~/shared/types/ai-knowledge'

export const AI_USAGE_COLLECTION = 'aiUsage'

// 月結桶用台灣時區（與方案付款週期 taipeiMonthPeriod 同一把尺；台灣固定 UTC+8、無 DST）。
// 月中切換與 UTC 同鍵,故當月用量 doc 不斷檔;僅月底 8 小時邊界改依台灣時間歸月。
export function currentYyyyMm(date = new Date()): string {
  return taipeiYyyyMm(date)
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
  /**
   * 匯入 / 整理（切卡、normalize）的 token 分項。**同時也要計入 inputTokens/outputTokens**
   * （quota 以總量計），這兩個欄位只是讓報表能區分「答題」與「匯入」的成本。
   */
  importInputTokens?: number
  importOutputTokens?: number
  /** AI answered 後 30 分鐘內客人又被轉真人 — 品質 proxy（回答沒解決問題） */
  answeredThenHandoffs?: number
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
  if (delta.importInputTokens) updates.importInputTokens = FieldValue.increment(delta.importInputTokens)
  if (delta.importOutputTokens) updates.importOutputTokens = FieldValue.increment(delta.importOutputTokens)
  if (delta.answeredThenHandoffs) updates.answeredThenHandoffs = FieldValue.increment(delta.answeredThenHandoffs)

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

export interface CurrentMonthUsage {
  /** input + output + embedding tokens（給 token 內部護欄用） */
  tokens: number
  /** answered 則數（給方案「則數額度」用） */
  answered: number
}

/**
 * 一次讀當月 usage doc，同時回傳 token 總量與 answered 則數。
 * 讓 quota 護欄的「則數額度」與「token 護欄」共用同一次 Firestore 讀取。
 */
export async function getCurrentMonthUsage(
  workspaceId: string,
  db: Firestore = getDb(),
): Promise<CurrentMonthUsage> {
  const yyyyMm = currentYyyyMm()
  const ref = db.collection(AI_USAGE_COLLECTION).doc(usageDocId(workspaceId, yyyyMm))
  const snap = await ref.get()
  if (!snap.exists) return { tokens: 0, answered: 0 }
  const data = snap.data() as Partial<AiUsageDoc>
  return {
    tokens: Number(data?.inputTokens ?? 0) + Number(data?.outputTokens ?? 0) + Number(data?.embeddingTokens ?? 0),
    answered: Number(data?.answered ?? 0),
  }
}
