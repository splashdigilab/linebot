import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { answerWithAi, type AiChatTurn } from '~~/server/utils/ai-answer'
import { findMatchingScriptLazy, loadActiveScripts } from '~~/server/utils/ai-scripts'
import { embedQuery } from '~~/server/utils/gemini'
import type { ScriptTriggerNode } from '~~/shared/types/ai-script'

/**
 * POST /api/ai/playground
 * Body: { query: string, history?: AiChatTurn[], skipDisambiguation?: boolean, isFollowup?: boolean }
 *
 * 跟 /answer 一樣，但帶 debug=true：會多回傳 debugPrompt 給管理員看到實際送給 LLM 的 prompt。
 * 並且**先模擬正式 LINE 的腳本觸發**：若這句會命中某條腳本，回報 scriptTrigger 且不跑 AI
 *   （正式對話中腳本優先於 AI 保底）。playground 不模擬腳本後續的多輪問答、也不含自動回覆規則。
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

  // ── 先模擬腳本觸發（與正式 LINE 同一套比對；命中就由腳本接手、不跑 AI）──
  // 只判「會不會觸發」，不真的啟動 / 持久化 activeScript。語意腳本算過的 queryVector 會傳給
  // answerWithAi 重用，避免重複 embed。
  const scripts = await loadActiveScripts(workspaceId).catch(() => [])
  const { script: triggered, queryVector } = scripts.length
    ? await findMatchingScriptLazy(scripts, query, embedQuery)
    : { script: null, queryVector: null }
  if (triggered) {
    const root = triggered.nodes.find(n => n.id === triggered.rootNodeId) as ScriptTriggerNode | undefined
    return {
      decision: 'skipped' as const,
      answer: '',
      confidence: 0,
      sources: [],
      handoffReason: null,
      scriptTrigger: {
        name: triggered.name,
        mode: (root?.matchMode ?? 'keyword') as 'keyword' | 'semantic',
      },
    }
  }

  return answerWithAi({
    workspaceId,
    query,
    history,
    debug: true,
    skipDisambiguation: body?.skipDisambiguation === true,
    isFollowup: body?.isFollowup === true,
    queryVector: queryVector ?? undefined,
  })
})
