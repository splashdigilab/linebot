/**
 * 推播發送前：將 LINE template 內的 URI action 改為先經 /api/r/:token 再 302 到原網址，
 * 以便寫入 broadcastClickLogs（multicast 同一則訊息，故 deliveryId / userId 留空，僅做活動層級統計）。
 */

function isHttpsUrl(s: string): boolean {
  return /^https:\/\//i.test(s.trim())
}

function alreadyTrackingUrl(uri: string, origin: string): boolean {
  const base = origin.replace(/\/$/, '')
  return uri.startsWith(`${base}/api/r/`)
}

function wrapOneUri(
  uri: string,
  campaignId: string,
  linkKey: string,
  origin: string,
): string {
  const u = uri.trim()
  if (!isHttpsUrl(u) || alreadyTrackingUrl(u, origin)) return uri
  const base = origin.replace(/\/$/, '')
  const token = Buffer.from(
    [campaignId, '', '', linkKey, u].join('|'),
    'utf-8',
  ).toString('base64url')
  return `${base}/api/r/${token}`
}

function wrapActionsArray(
  actions: unknown[] | undefined,
  campaignId: string,
  origin: string,
  keyPrefix: string,
): void {
  if (!Array.isArray(actions)) return
  actions.forEach((raw, i) => {
    const a = raw as { type?: string; uri?: string }
    if (a?.type === 'uri' && typeof a.uri === 'string') {
      a.uri = wrapOneUri(a.uri, campaignId, `${keyPrefix}_${i}`, origin)
    }
  })
}

/**
 * 回傳新物件（深拷貝自 messages），僅替換可辨識的 template URI。
 */
export function wrapBroadcastMessagesForClickTracking(
  messages: unknown[],
  campaignId: string,
  originWithoutTrailingSlash: string,
): unknown[] {
  const origin = String(originWithoutTrailingSlash || '').trim().replace(/\/$/, '')
  if (!origin.startsWith('http')) return messages

  const cloned = JSON.parse(JSON.stringify(messages)) as Record<string, unknown>[]

  for (const msg of cloned) {
    if (msg?.type !== 'template' || !msg.template || typeof msg.template !== 'object') continue
    const tpl = msg.template as Record<string, unknown>
    const t = String(tpl.type || '')

    if (t === 'buttons' || t === 'confirm') {
      wrapActionsArray(tpl.actions as unknown[] | undefined, campaignId, origin, `tpl_${t}`)
    }
    else if (t === 'carousel' && Array.isArray(tpl.columns)) {
      tpl.columns.forEach((col: Record<string, unknown>, ci: number) => {
        wrapActionsArray(col.actions as unknown[] | undefined, campaignId, origin, `car_${ci}`)
      })
    }
    else if (t === 'image_carousel' && Array.isArray(tpl.columns)) {
      tpl.columns.forEach((col: Record<string, unknown>, ci: number) => {
        const act = col.action as { type?: string; uri?: string } | undefined
        if (act?.type === 'uri' && typeof act.uri === 'string') {
          act.uri = wrapOneUri(act.uri, campaignId, `imgcar_${ci}`, origin)
        }
      })
    }
  }

  return cloned
}
