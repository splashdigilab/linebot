import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireFirebaseAuth } from '~~/server/utils/admin-auth'
import {
  invalidateLineWorkspaceCredentialsCache,
} from '~~/server/utils/line-workspace-credentials'
import { DEFAULT_LINE_WORKSPACE_ID } from '~~/shared/line-workspace'
import {
  fetchLineWebhookEndpoint,
  postLineWebhookTest,
} from '~~/server/utils/line-webhook-remote'

type PutBody = {
  name?: string
  defaultLiffId?: string
  channelAccessToken?: string
  channelSecret?: string
  /** 為 true 時刪除整份 workspaces/default。 */
  clearWorkspace?: boolean
  /** 為 true 時：儲存後自動呼叫 LINE 測試 Webhook；失敗僅回傳警告，不回滾憑證。 */
  verifyWebhookOnSave?: boolean
  /** 可選：期望與 LINE 後台登記的 Webhook URL 比對。 */
  compareWebhookUrl?: string
}

type WebhookVerificationResult = {
  ok: boolean
  message: string
}

function normalizeWebhookUrl(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  try {
    const u = new URL(s)
    u.hash = ''
    let path = u.pathname.replace(/\/+$/, '') || '/'
    if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1)
    u.pathname = path
    return u.href.replace(/\/$/, '')
  }
  catch {
    return s.replace(/\/+$/, '')
  }
}

/**
 * PUT /api/admin/line-workspace
 * 以 merge 更新。`channelAccessToken` / `channelSecret` 僅在 body 含該欄位時寫入；
 * 傳空字串表示刪除該欄位（改由環境變數補齊）。
 */
export default defineEventHandler(async (event) => {
  await requireFirebaseAuth(event)

  const body = await readBody(event) as PutBody

  if (body?.clearWorkspace === true) {
    const db = getDb()
    await db.collection('workspaces').doc(DEFAULT_LINE_WORKSPACE_ID).delete().catch(() => {})
    invalidateLineWorkspaceCredentialsCache()
    return { ok: true, cleared: true }
  }

  const db = getDb()
  const ref = db.collection('workspaces').doc(DEFAULT_LINE_WORKSPACE_ID)
  const snap = await ref.get()
  const previous = snap.exists ? snap.data() as Record<string, unknown> : null

  const updates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (body?.name !== undefined) {
    updates.name = String(body.name).trim() || 'default'
  }
  else if (!snap.exists) {
    updates.name = 'default'
  }

  if (Object.prototype.hasOwnProperty.call(body, 'defaultLiffId')) {
    const v = String(body.defaultLiffId ?? '').trim()
    updates.defaultLiffId = v ? v : FieldValue.delete()
  }

  if (Object.prototype.hasOwnProperty.call(body, 'channelAccessToken')) {
    const v = String(body.channelAccessToken ?? '').trim()
    updates.channelAccessToken = v ? v : FieldValue.delete()
  }

  if (Object.prototype.hasOwnProperty.call(body, 'channelSecret')) {
    const v = String(body.channelSecret ?? '').trim()
    updates.channelSecret = v ? v : FieldValue.delete()
  }

  await ref.set(updates, { merge: true })
  invalidateLineWorkspaceCredentialsCache()

  let webhookVerification: WebhookVerificationResult | undefined

  if (body?.verifyWebhookOnSave === true) {
    const merged = {
      ...(previous || {}),
      ...updates,
    } as Record<string, unknown>
    const channelAccessToken = String(merged.channelAccessToken ?? '').trim()
    const compareWebhookUrl = normalizeWebhookUrl(String(body.compareWebhookUrl ?? ''))

    if (!channelAccessToken) {
      webhookVerification = {
        ok: false,
        message: '已儲存，但 Firestore 仍缺少 Channel Access Token，無法驗證 Webhook',
      }
    }
    else {
      const getRes = await fetchLineWebhookEndpoint(channelAccessToken)
      if (!getRes.ok) {
        webhookVerification = {
          ok: false,
          message: getRes.status === 404
            ? '已儲存，但 LINE 後台尚未設定 Webhook URL'
            : `已儲存，但 LINE 查詢 Webhook 失敗（HTTP ${getRes.status}）`,
        }
      }
      else if (compareWebhookUrl) {
        const endpoint = normalizeWebhookUrl(String(getRes.data.endpoint || ''))
        if (endpoint !== compareWebhookUrl) {
          webhookVerification = {
            ok: false,
            message: '已儲存，但 LINE 後台 Webhook URL 與系統網址不一致',
          }
        }
      }

      if (!webhookVerification) {
        const testRes = await postLineWebhookTest(channelAccessToken, {})
        if (!testRes.ok) {
          webhookVerification = {
            ok: false,
            message: `已儲存，但 LINE 測試 API 失敗（HTTP ${testRes.status}）`,
          }
        }
        else if (!testRes.data.success) {
          webhookVerification = {
            ok: false,
            message: `已儲存，但 Webhook 測試未通過（${testRes.data.reason || 'UNKNOWN'}${testRes.data.statusCode != null ? ` / HTTP ${testRes.data.statusCode}` : ''}）`,
          }
        }
        else {
          webhookVerification = {
            ok: true,
            message: '已儲存，Webhook 驗證通過',
          }
        }
      }
    }
  }

  return { ok: true, id: DEFAULT_LINE_WORKSPACE_ID, webhookVerification }
})
