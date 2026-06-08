import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { answerWithAi } from '~~/server/utils/ai-answer'

/**
 * POST /api/ai/playground
 * Body: { query: string, skipDisambiguation?: boolean, isFollowup?: boolean }
 *
 * 跟 /answer 一樣，但帶 debug=true：會多回傳 debugPrompt 給管理員看到實際送給 LLM 的 prompt。
 * skipDisambiguation / isFollowup 讓前端模擬「客人點按鈕後的下一輪」— 避免再次觸發反問澄清。
 * 不影響正式對話（不寫 conversation 紀錄；usage 仍會記，這部分跟正式呼叫共用）。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  const body = await readBody(event)
  const query = String(body?.query ?? '').trim()
  if (!query) throw createError({ statusCode: 400, statusMessage: '請輸入 query' })

  return answerWithAi({
    workspaceId,
    query,
    debug: true,
    skipDisambiguation: body?.skipDisambiguation === true,
    isFollowup: body?.isFollowup === true,
  })
})
