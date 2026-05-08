import { handleFollowEvent } from '~~/server/utils/handler'

/**
 * POST /api/liff/apply
 *
 * 由 LIFF 前端在顯示成功畫面後，以背景 fetch（keepalive: true）呼叫。
 * 負責執行貼標、模組推播等耗時操作，不阻塞 /api/liff/claim 的回應。
 *
 * 前端使用 keepalive: true，確保頁面跳轉或 LIFF 關閉後請求仍能完成。
 * 若本次呼叫失敗，claim 的 status 仍為 'claimed'，使用者重新點擊活動連結可再次觸發。
 *
 * Body: { lineUserId: string, workspaceId: string }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const lineUserId = String(body?.lineUserId || '').trim()
  const workspaceId = String(body?.workspaceId || '').trim()

  if (!lineUserId || !workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'lineUserId and workspaceId are required' })
  }

  try {
    await handleFollowEvent(lineUserId, null, workspaceId)
  }
  catch (e) {
    console.error('[liff/apply] handleFollowEvent failed:', lineUserId, workspaceId, e)
    return { ok: false }
  }

  return { ok: true }
})
