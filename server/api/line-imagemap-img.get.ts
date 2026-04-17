import { verifyImagemapImageToken } from '../utils/line-imagemap-image-token'
import { respondImagemapImage } from '../utils/line-imagemap-image-response'
import { getLineWorkspaceCredentials } from '../utils/line-workspace-credentials'

function normalizeSize(raw: string): string {
  // 兼容 LINE 可能送來的 `1040`、`/1040`、`1040x1040` 形式，抓第一段數字即可
  return String(raw || '').match(/(\d{2,5})/)?.[1] || ''
}

/**
 * 舊版 query 形式相容路由：/api/line-imagemap-img?token=...&z=1040
 * 驗簽後 302 轉到實際圖檔，讓聊天室內可保留 PNG 透明（Flex 會把透明當白底）。
 */
export default defineEventHandler(async (event) => {
  const { channelSecret: secret } = await getLineWorkspaceCredentials()
  if (!secret) {
    throw createError({ statusCode: 503, statusMessage: 'Missing LINE channel secret' })
  }

  const q = getQuery(event)
  const token = String(q.token ?? '')
  const url = verifyImagemapImageToken(token, secret)
  if (!url) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid or expired token' })
  }

  const zRaw = String(q.z ?? '')
  const z = normalizeSize(zRaw)
  if (zRaw && !z) {
    console.warn('[line-imagemap-img] unexpected z query:', zRaw)
  }

  return await respondImagemapImage(event, url)
})
