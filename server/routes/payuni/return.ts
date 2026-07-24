/**
 * /payuni/return — PAYUNi 付款後瀏覽器導回(僅顯示,非開通依據;開通只信 notify)。
 *
 * 由建單時帶在 ReturnURL query 的 ws/no 決定導向哪個帳號的帳單頁;頁面自行向
 * API 讀該訂單最新狀態顯示結果。PAYUNi 以 POST 導回,故不限方法(只讀 query)。
 */
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const ws = String(q.ws || '').trim()
  const no = String(q.no || '').trim()
  if (ws) {
    const suffix = no ? `?order=${encodeURIComponent(no)}` : ''
    return sendRedirect(event, `/admin/${encodeURIComponent(ws)}/settings/billing${suffix}`, 302)
  }
  return sendRedirect(event, '/admin', 302)
})
