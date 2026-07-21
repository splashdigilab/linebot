import type { H3Event } from 'h3'

/**
 * 由伺服器抓取實際圖片並直接回傳二進位內容。
 * 可避免部分 LINE 客戶端對 302 轉址處理不一致造成的下載失敗。
 */
export async function respondImagemapImage(event: H3Event, imageUrl: string): Promise<Response> {
  let upstream: Response
  try {
    upstream = await fetch(imageUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        // 額外附上 UA，降低來源端對空 UA 的阻擋機率
        'user-agent': 'linebot-imagemap-proxy/1.0',
      },
    })
  }
  catch (error) {
    console.error('[line-imagemap-img] upstream fetch error:', error)
    throw createError({ statusCode: 502, statusMessage: 'Failed to fetch source image' })
  }

  if (!upstream.ok) {
    console.error('[line-imagemap-img] upstream non-200:', upstream.status, imageUrl)
    throw createError({ statusCode: 502, statusMessage: `Source image unavailable (${upstream.status})` })
  }

  const contentType = upstream.headers.get('content-type') || 'image/png'
  const arrayBuffer = await upstream.arrayBuffer()
  const headers = new Headers()
  headers.set('content-type', contentType)
  // URL 帶簽章 token、同一 URL 內容不變,讓 LINE 手機端與 CDN 長期快取
  // （30 天,與 token 桶期一致）;快取命中時同一張圖第二次起免重新下載。
  headers.set('cache-control', 'public, max-age=2592000, immutable')
  headers.set('content-length', String(arrayBuffer.byteLength))
  headers.set('x-line-imagemap-proxy', '1')

  return new Response(arrayBuffer, {
    status: 200,
    headers,
  })
}
