/**
 * 活動 LIFF 進入頁：從網址取得 ct（兌換 token）與 c（活動代碼，僅顯示用）。
 * LINE 可能把原始 query 放在 `liff.state`（例如 Endpoint 誤設為 /webhook 時）。
 */
export function parseLeadClaimFromQuery(query: Record<string, unknown>): { ct: string; campaignCode: string } {
  const pick = (key: string): string => {
    const v = query[key]
    if (Array.isArray(v)) return String(v[0] ?? '').trim()
    if (v == null) return ''
    return String(v).trim()
  }

  let ct = pick('ct')
  let campaignCode = pick('c')

  const stateRaw = pick('liff.state') || pick('liff_state')
  if (stateRaw) {
    try {
      const decoded = decodeURIComponent(stateRaw.replace(/\+/g, '%20'))
      const withoutQ = decoded.startsWith('?') ? decoded.slice(1) : decoded
      const sp = new URLSearchParams(withoutQ)
      if (!ct) ct = String(sp.get('ct') || '').trim()
      if (!campaignCode) campaignCode = String(sp.get('c') || '').trim()
    }
    catch {
      // ignore malformed state
    }
  }

  return { ct, campaignCode }
}
