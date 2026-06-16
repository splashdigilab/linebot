import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { answerWithAi, type AiChatTurn } from '~~/server/utils/ai-answer'

/**
 * POST /api/ai/playground
 * Body: { query: string, history?: AiChatTurn[], skipDisambiguation?: boolean, isFollowup?: boolean }
 *
 * 跟 /answer 一樣，但帶 debug=true：會多回傳 debugPrompt 給管理員看到實際送給 LLM 的 prompt。
 * history 讓 playground 跟正式 LINE 一樣支援多輪追問（追問補救檢索 + 脈絡帶入 prompt）。
 * skipDisambiguation / isFollowup 讓前端模擬「客人點按鈕後的下一輪」— 避免再次觸發反問澄清。
 * 不影響正式對話（不寫 conversation 紀錄；usage 仍會記，這部分跟正式呼叫共用）。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  const body = await readBody(event)
  const query = String(body?.query ?? '').trim()
  if (!query) throw createError({ statusCode: 400, statusMessage: '請輸入 query' })

  // history 來自前端、不可信：只收 role 合法、text 有內容的項目，並截最近 6 則
  const history: AiChatTurn[] = Array.isArray(body?.history)
    ? body.history
        .map((t: any) => ({
          role: t?.role === 'bot' ? 'bot' as const : 'user' as const,
          text: String(t?.text ?? '').trim(),
        }))
        .filter((t: AiChatTurn) => t.text)
        .slice(-6)
    : []

  return answerWithAi({
    workspaceId,
    query,
    history,
    debug: true,
    skipDisambiguation: body?.skipDisambiguation === true,
    isFollowup: body?.isFollowup === true,
  })
})
