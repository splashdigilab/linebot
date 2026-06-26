import type { SetupItemStatus, SetupStatusItem, SetupStatusResponse } from '~~/shared/types/setup'
import { getAiSettings } from '~~/server/utils/ai-settings'
import { KNOWLEDGE_CHUNKS_COLLECTION } from '~~/server/utils/ai-knowledge-chunks'
import { loadActiveScripts } from '~~/server/utils/ai-scripts'
import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

/**
 * GET /api/admin/setup-status?workspaceId=...
 *
 * 依真實資料訊號判定每個設定能力是否完成，給前端的教學 agent 做「主動告知哪裡沒做完」。
 * 每個訊號各自 try/catch：單一查詢失敗只會讓該項變成 unknown，不會讓整支端點壞掉，
 * 也不會把「查不到」誤報成「沒做」。
 */

/** 把一個布林判定包成 done/incomplete；丟錯則降級為 unknown（狀態未知，不等於沒做） */
async function resolve(check: () => Promise<boolean>): Promise<SetupItemStatus> {
  try {
    return (await check()) ? 'done' : 'incomplete'
  }
  catch {
    return 'unknown'
  }
}

export default defineEventHandler(async (event): Promise<SetupStatusResponse> => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'viewer')
  const wid = String(workspaceId || '').trim()
  if (!wid)
    throw createError({ statusCode: 400, statusMessage: 'workspaceId is required' })

  const db = getDb()

  const [lineConnected, aiEnabled, knowledgeReady, scriptReady] = await Promise.all([
    // 已接 LINE：Token / Secret / 預設 LIFF 三者都有（與組織頁的儲存條件一致）
    resolve(async () => {
      const snap = await db.collection('workspaces').doc(wid).get()
      const w = snap.exists ? (snap.data() as Record<string, unknown>) : null
      return (
        !!String(w?.channelAccessToken ?? '').trim()
        && !!String(w?.channelSecret ?? '').trim()
        && !!String(w?.defaultLiffId ?? '').trim()
      )
    }),
    // 已開 AI 自動回覆
    resolve(async () => {
      const s = await getAiSettings(wid, db)
      return s.enabled === true
    }),
    // 知識庫有內容：存在任一筆此 workspace 的知識片段（單欄位查詢，免複合索引）
    resolve(async () => {
      const snap = await db
        .collection(KNOWLEDGE_CHUNKS_COLLECTION)
        .where('workspaceId', '==', wid)
        .limit(1)
        .get()
      return !snap.empty
    }),
    // 有啟用中的客服腳本：沿用既有 loadActiveScripts（已過濾 enabled）
    resolve(async () => {
      const scripts = await loadActiveScripts(wid, db)
      return scripts.length > 0
    }),
  ])

  const items: SetupStatusItem[] = [
    { id: 'lineConnected', status: lineConnected },
    { id: 'aiEnabled', status: aiEnabled },
    { id: 'knowledgeReady', status: knowledgeReady },
    { id: 'scriptReady', status: scriptReady },
  ]

  return { workspaceId: wid, items }
})
