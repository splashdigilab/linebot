/**
 * 活動 LIFF 進入頁：從網址取得 claimToken/ct（兌換 token）、c（活動代碼）與 liffId（初始化 LIFF SDK）。
 * LINE 可能把原始 query 放在 `liff.state`。
 */
export function parseLeadClaimFromQuery(
  query: Record<string, unknown>,
): { ct: string; campaignCode: string; liffId: string } {
  const pick = (key: string): string => {
    const v = query[key]
    if (Array.isArray(v)) return String(v[0] ?? '').trim()
    if (v == null) return ''
    return String(v).trim()
  }

  let ct = pick('claimToken') || pick('claim_token') || pick('ct')
  let campaignCode = pick('c')
  let liffId = pick('liffId') || pick('liff_id')

  const referrer = pick('liff.referrer')
  if (!liffId && referrer) {
    try {
      const u = new URL(referrer)
      const seg = u.pathname.split('/').filter(Boolean)
      if (seg.length > 0)
        liffId = String(seg[seg.length - 1] || '').trim()
    }
    catch {
      // ignore malformed referrer
    }
  }

  const stateRaw = pick('liff.state') || pick('liff_state')
  if (stateRaw) {
    try {
      let cursor = stateRaw
      for (let i = 0; i < 4; i++) {
        const decoded = decodeURIComponent(String(cursor || '').replace(/\+/g, '%20'))
        let search = ''
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
          search = new URL(decoded).search
        }
        else {
          const qIndex = decoded.indexOf('?')
          search = qIndex >= 0 ? decoded.slice(qIndex) : decoded
        }
        const normalized = search.startsWith('?') ? search.slice(1) : search
        const sp = new URLSearchParams(normalized)

        if (!ct) ct = String(sp.get('claimToken') || sp.get('claim_token') || sp.get('ct') || '').trim()
        if (!campaignCode) campaignCode = String(sp.get('c') || '').trim()
        if (!liffId) liffId = String(sp.get('liffId') || sp.get('liff_id') || '').trim()

        const nested = String(sp.get('liff.state') || sp.get('liff_state') || '').trim()
        if (!nested) break
        cursor = nested
      }
    }
    catch {
      // ignore malformed state
    }
  }

  return { ct, campaignCode, liffId }
}
