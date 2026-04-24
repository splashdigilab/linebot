import { requireFirebaseAuth } from '~~/server/utils/admin-auth'
import { getLineWorkspaceCredentials } from '~~/server/utils/line-workspace-credentials'
import {
  type LineWebhookTestResult,
  fetchLineWebhookEndpoint,
  postLineWebhookTest,
} from '~~/server/utils/line-webhook-remote'

function normalizeWebhookCompareUrl(raw: string): string {
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

export type LineWebhookVerifyResponse = {
  tokenOk: boolean
  getOk: boolean
  getStatus?: number
  getMessage?: string
  getBody?: unknown
  lineEndpoint: string | null
  lineActive: boolean | null
  urlMatchesCompare: boolean | null
  test: LineWebhookTestResult | null
  testSkipped: boolean
  testError?: string
  testBody?: unknown
}

/**
 * POST /api/admin/line-webhook-verify
 * 以目前 Channel Access Token 向 LINE 查詢 Webhook 設定，並可選請 LINE 對已設定 URL 發送測試請求。
 *
 * Body: { compareUrl?: string, runTest?: boolean } — compareUrl 通常為管理後台推算的 `…/webhook`；runTest 預設 true
 */
export default defineEventHandler(async (event): Promise<LineWebhookVerifyResponse> => {
  await requireFirebaseAuth(event)

  const body = await readBody(event).catch(() => ({})) as Record<string, unknown>
  const compareUrl = normalizeWebhookCompareUrl(String(body?.compareUrl ?? ''))
  const runTest = body?.runTest !== false

  const { channelAccessToken } = await getLineWorkspaceCredentials()
  const token = String(channelAccessToken || '').trim()
  if (!token) {
    throw createError({
      statusCode: 400,
      statusMessage: '尚未設定 Channel Access Token（Firestore 或環境變數）',
    })
  }

  const getRes = await fetchLineWebhookEndpoint(token)
  if (!getRes.ok) {
    const msg = getRes.status === 404
      ? 'LINE 後台尚未設定 Webhook URL'
      : `無法向 LINE 查詢 Webhook（HTTP ${getRes.status}）`
    return {
      tokenOk: true,
      getOk: false,
      getStatus: getRes.status,
      getMessage: msg,
      getBody: getRes.body,
      lineEndpoint: null,
      lineActive: null,
      urlMatchesCompare: null,
      test: null,
      testSkipped: true,
    }
  }

  const { endpoint, active } = getRes.data
  const urlMatchesCompare = compareUrl
    ? normalizeWebhookCompareUrl(endpoint) === normalizeWebhookCompareUrl(compareUrl)
    : null

  let test: LineWebhookTestResult | null = null
  let testSkipped = true
  let testError: string | undefined
  let testBody: unknown

  if (runTest && endpoint) {
    const testRes = await postLineWebhookTest(token, {})
    testSkipped = false
    if (testRes.ok) {
      test = testRes.data
    }
    else {
      testError = `LINE 測試 API 失敗（HTTP ${testRes.status}）`
      testBody = testRes.body
    }
  }

  return {
    tokenOk: true,
    getOk: true,
    lineEndpoint: endpoint,
    lineActive: active,
    urlMatchesCompare,
    test,
    testSkipped,
    testError,
    testBody,
  }
})
