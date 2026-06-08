import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { AI_USAGE_COLLECTION, currentYyyyMm } from '~~/server/utils/ai-usage'
import type { AiUsageDoc } from '~~/shared/types/ai-knowledge'

/**
 * GET /api/ai/usage/summary?period=YYYYMM
 *
 * 回傳指定月份的 AI 用量 KPI：
 *   - invocations / answered / handoffs
 *   - 自動回覆率 / handoff 率
 *   - input / output / embedding tokens
 *   - 估算成本（USD，依模型 list price 粗估）
 */
const GEMINI_FLASH_INPUT_USD_PER_M = 0.075
const GEMINI_FLASH_OUTPUT_USD_PER_M = 0.30
const GEMINI_EMBED_USD_PER_M = 0.025

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'viewer')
  const query = getQuery(event)
  const period = String(query.period ?? currentYyyyMm()).replace(/[^\d]/g, '').slice(0, 6) || currentYyyyMm()

  const db = getDb()
  const snap = await db.collection(AI_USAGE_COLLECTION).doc(`${workspaceId}_${period}`).get()

  const empty = {
    period,
    invocations: 0,
    answered: 0,
    handoffs: 0,
    disambiguations: 0,
    inputTokens: 0,
    outputTokens: 0,
    embeddingTokens: 0,
    autoReplyRate: 0,
    handoffRate: 0,
    disambiguationRate: 0,
    estimatedCostUsd: 0,
    perConversationUsd: 0,
  }
  if (!snap.exists) return empty

  const data = snap.data() as Partial<AiUsageDoc>
  const invocations = Number(data.invocations ?? 0)
  const answered = Number(data.answered ?? 0)
  const handoffs = Number(data.handoffs ?? 0)
  const disambiguations = Number(data.disambiguations ?? 0)
  const inputTokens = Number(data.inputTokens ?? 0)
  const outputTokens = Number(data.outputTokens ?? 0)
  const embeddingTokens = Number(data.embeddingTokens ?? 0)

  const cost
    = (inputTokens / 1_000_000) * GEMINI_FLASH_INPUT_USD_PER_M
    + (outputTokens / 1_000_000) * GEMINI_FLASH_OUTPUT_USD_PER_M
    + (embeddingTokens / 1_000_000) * GEMINI_EMBED_USD_PER_M

  return {
    period,
    invocations,
    answered,
    handoffs,
    disambiguations,
    inputTokens,
    outputTokens,
    embeddingTokens,
    autoReplyRate: invocations ? answered / invocations : 0,
    handoffRate: invocations ? handoffs / invocations : 0,
    disambiguationRate: invocations ? disambiguations / invocations : 0,
    estimatedCostUsd: Number(cost.toFixed(4)),
    perConversationUsd: invocations ? Number((cost / invocations).toFixed(4)) : 0,
  }
})
