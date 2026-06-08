import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { answerWithAi } from '~~/server/utils/ai-answer'

/**
 * POST /api/ai/answer
 * Body: { query: string }
 * Resp: AiAnswerResult
 *
 * 給 Playground / webhook / 內部測試共用。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  const body = await readBody(event)
  const query = String(body?.query ?? '').trim()
  if (!query) throw createError({ statusCode: 400, statusMessage: '請輸入 query' })

  return answerWithAi({ workspaceId, query })
})
