import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { answerWithAi } from '~~/server/utils/ai-answer'

/**
 * POST /api/ai/answer
 * Body: { query: string }
 * Resp: AiAnswerResult
 *
 * 內部/測試用（admin capability；真實 LINE 客服走 handler.ts 直接呼叫 answerWithAi，不經此端點）。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  const body = await readBody(event)
  const query = String(body?.query ?? '').trim()
  if (!query) throw createError({ statusCode: 400, statusMessage: '請輸入 query' })

  // 測試呼叫：只記 token、不記次數/率、不消耗額度（見 answerWithAi 的 isTest）。
  return answerWithAi({ workspaceId, query, isTest: true })
})
