import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'

/**
 * 交易通知信寄送（AWS SES）。
 *
 * 設計原則（與 ezpay 開票、金流一致）：
 *   - **Gated**：EMAIL_FROM + AWS_SES_REGION 都設齊才真的寄；未設 → no-op（只 log）。
 *     這讓「SES 帳號還沒申請 / 網域還沒驗證」的現狀不會壞掉任何流程。
 *   - **永不 throw**：呼叫端多在金流 webhook / 排程對帳的路徑上，寄信失敗**絕不能**
 *     拖累主流程（webhook 回非 200 → 藍新重送 → 重複結算）。所有失敗吞掉、回 { ok:false }。
 *
 * 憑證不放 runtimeConfig：SES SDK 走預設憑證鏈（Amplify 執行角色 / 環境變數），
 * 只需要區域與寄件人。
 */

let cachedClient: SESv2Client | undefined
let cachedRegion: string | undefined

interface EmailConfig {
  from: string
  replyTo: string
  region: string
}

function readConfig(): EmailConfig {
  const c = useRuntimeConfig()
  return {
    from: String(c.emailFrom ?? '').trim(),
    replyTo: String(c.emailReplyTo ?? '').trim(),
    region: String(c.awsSesRegion ?? '').trim(),
  }
}

/** SES 是否設定齊全（寄件人 + 區域）。未齊全時所有寄信會 no-op。 */
export function isEmailConfigured(): boolean {
  const { from, region } = readConfig()
  return !!from && !!region
}

function getClient(region: string): SESv2Client {
  if (!cachedClient || cachedRegion !== region) {
    cachedClient = new SESv2Client({ region })
    cachedRegion = region
  }
  return cachedClient
}

export interface SendEmailInput {
  to: string
  subject: string
  /** HTML 內文（呼叫端負責跳脫動態值） */
  html: string
  /** 純文字 fallback（收件端不支援 HTML 時顯示） */
  text: string
}

export interface SendEmailResult {
  ok: boolean
  /** true = 因未設定 SES 或無收件人而略過（非錯誤） */
  skipped?: boolean
  error?: string
}

/**
 * 寄一封信。未設定 SES 或無收件人 → 略過（skipped）；SES 失敗 → 記 log 並回 error。
 * 這個函式**永不 throw**。
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const to = input.to?.trim()
  if (!to) return { ok: false, skipped: true }

  const cfg = readConfig()
  if (!cfg.from || !cfg.region) {
    console.log('[email] 未設定 SES（EMAIL_FROM / AWS_SES_REGION），略過寄信：', input.subject, '→', to)
    return { ok: false, skipped: true }
  }

  try {
    const ses = getClient(cfg.region)
    await ses.send(new SendEmailCommand({
      FromEmailAddress: cfg.from,
      ...(cfg.replyTo ? { ReplyToAddresses: [cfg.replyTo] } : {}),
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: input.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: input.html, Charset: 'UTF-8' },
            Text: { Data: input.text, Charset: 'UTF-8' },
          },
        },
      },
    }))
    return { ok: true }
  }
  catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[email] 寄信失敗：', input.subject, '→', to, msg)
    return { ok: false, error: msg }
  }
}
