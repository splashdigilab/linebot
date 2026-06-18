/**
 * Google Sheet 讀取 + 「一列 = 一張知識卡」對應。
 *
 * 設計：
 * - 用既有的 Firebase 服務帳號憑證（firebaseClientEmail / firebasePrivateKey）換 access token，
 *   不另外申請憑證。商家把自己的 Sheet「分享給服務帳號 email（檢視權限）」即可。
 * - 走 Sheets API REST（values.get）+ fetch，不引入 googleapis 重套件。
 * - 做法 1：Sheet 本來就是結構化表格，直接「一列一卡」程式對應，不丟 LLM 切卡
 *   → 自動同步時零 LLM 成本、結果穩定、商家可預期。
 *
 * 紅線：只讀「分享給服務帳號」的 Sheet，不繞權限；讀不到就請商家確認分享設定。
 */
import { JWT } from 'google-auth-library'

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

/** 一張 Sheet 最多轉幾張卡（與 bulk-create 的 MAX_BULK_CHUNKS 對齊，避免匯入超量） */
export const GSHEET_MAX_ROWS = 150

/** 單卡內容上限（與 validateChunkInput 的 5000 對齊） */
const CARD_CONTENT_MAX = 5000

/** 服務帳號的 row→card 結果 */
export interface SheetCard {
  title: string
  content: string
  tags: string[]
}

export interface ReadSheetResult {
  /** 解析出的卡片（已套用 GSHEET_MAX_ROWS 上限） */
  cards: SheetCard[]
  /** 實際讀到的資料列數（不含表頭、未截斷前） */
  rowCount: number
  /** 是否因超過 GSHEET_MAX_ROWS 被截斷 */
  truncated: boolean
  /** 實際讀取的分頁標題 */
  sheetTitle: string
}

// ── 服務帳號 token（JWT client 內部自動快取/續期，建一次重用） ──────────
let jwtClient: JWT | null = null

function getJwtClient(): JWT {
  if (jwtClient) return jwtClient
  const config = useRuntimeConfig()
  const email = config.firebaseClientEmail
  const key = String(config.firebasePrivateKey || '').replace(/\\n/g, '\n')
  if (!email || !key) {
    throw createError({ statusCode: 500, statusMessage: '伺服器未設定 Google 服務帳號憑證' })
  }
  jwtClient = new JWT({ email, key, scopes: [SHEETS_SCOPE] })
  return jwtClient
}

/** 這個部署用哪個服務帳號 email 讀 Sheet（給前端提示「請把表單分享給這個帳號」）。 */
export function getServiceAccountEmail(): string {
  return useRuntimeConfig().firebaseClientEmail || ''
}

async function getAccessToken(): Promise<string> {
  const { token } = await getJwtClient().getAccessToken()
  if (!token) throw createError({ statusCode: 502, statusMessage: '無法取得 Google 存取權杖' })
  return token
}

// ── URL / id 解析 ───────────────────────────────────────────────────

export interface ParsedSheetRef {
  spreadsheetId: string
  /** URL #gid=... 指定的分頁數字 id；沒有則 null（讀第一個分頁） */
  gid: string | null
}

/**
 * 從使用者貼的內容解析出 spreadsheetId 與 gid。接受：
 *   - 完整網址 https://docs.google.com/spreadsheets/d/<ID>/edit#gid=123
 *   - 純 spreadsheetId（44 字左右的英數 + - _）
 * 解析不出 id 回 null。
 */
export function parseGoogleSheetUrl(input: string): ParsedSheetRef | null {
  const raw = String(input || '').trim()
  if (!raw) return null

  const idFromUrl = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  const gidMatch = raw.match(/[#&?]gid=([0-9]+)/)
  if (idFromUrl?.[1]) {
    return { spreadsheetId: idFromUrl[1], gid: gidMatch?.[1] ?? null }
  }
  // 純 id（沒有斜線、沒有空白、長度合理）
  if (/^[a-zA-Z0-9-_]{20,}$/.test(raw)) {
    return { spreadsheetId: raw, gid: null }
  }
  return null
}

// ── Sheets API 呼叫 ─────────────────────────────────────────────────

async function sheetsApi<T>(path: string): Promise<T> {
  const token = await getAccessToken()
  let res: Response
  try {
    res = await fetch(`${SHEETS_API_BASE}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    })
  }
  catch (err: any) {
    throw createError({ statusCode: 502, statusMessage: `Google Sheets 連線失敗：${err?.message ?? 'unknown'}` })
  }
  if (res.status === 403 || res.status === 404) {
    // 403 有兩種：API 沒啟用 vs 表單沒分享。讀 body 區分，給對應排查指引。
    const body = await res.text().catch(() => '')
    // Google 的原始 error.message 內含「確切的專案編號 + 啟用連結」，直接透出，避免猜錯專案
    let googleMsg = ''
    try { googleMsg = String(JSON.parse(body)?.error?.message ?? '') }
    catch { googleMsg = body.slice(0, 400) }
    const apiDisabled = /SERVICE_DISABLED|has not been used in project|Sheets API.*disabled/i.test(body)
    const email = getServiceAccountEmail()
    throw createError({
      statusCode: 422,
      statusMessage: apiDisabled
        ? `Google Sheets API 尚未在「服務帳號所屬的專案」啟用。請依 Google 指示的連結（含正確專案編號）啟用後等 1–2 分鐘再試。Google 原始訊息：${googleMsg}`
        : `讀不到這份 Google Sheet（${res.status}）。請把表單「分享」給服務帳號：${email}（檢視權限即可，並取消勾選「通知使用者」）。Google 原始訊息：${googleMsg}`,
    })
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw createError({ statusCode: 502, statusMessage: `Google Sheets API 錯誤 ${res.status}：${body.slice(0, 200)}` })
  }
  return res.json() as Promise<T>
}

interface SheetMeta {
  sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>
}

/** 解析要讀哪個分頁：gid 對得上就用該分頁標題，否則用第一個分頁。 */
async function resolveSheetTitle(spreadsheetId: string, gid: string | null): Promise<string> {
  const meta = await sheetsApi<SheetMeta>(
    `${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent('sheets.properties(sheetId,title)')}`,
  )
  const sheets = meta.sheets ?? []
  if (!sheets.length) throw createError({ statusCode: 422, statusMessage: '這份試算表沒有任何分頁' })
  if (gid != null) {
    const match = sheets.find(s => String(s.properties?.sheetId) === gid)
    if (match?.properties?.title) return match.properties.title
  }
  return sheets[0]!.properties?.title ?? 'Sheet1'
}

interface ValuesResponse {
  values?: string[][]
}

/**
 * 讀取一份 Google Sheet 並轉成知識卡。
 * 第一列當表頭；第一欄當「標題 / 比對 key」，其餘欄位組成卡片內容。
 */
export async function readGoogleSheetAsCards(ref: ParsedSheetRef): Promise<ReadSheetResult> {
  const sheetTitle = await resolveSheetTitle(ref.spreadsheetId, ref.gid)
  // 整個分頁（最多 A:Z 之外也讀，靠 range = 分頁名）
  const data = await sheetsApi<ValuesResponse>(
    `${encodeURIComponent(ref.spreadsheetId)}/values/${encodeURIComponent(sheetTitle)}?majorDimension=ROWS`,
  )
  const rows = (data.values ?? []).filter(r => r.some(c => String(c ?? '').trim()))
  if (rows.length < 2) {
    throw createError({ statusCode: 422, statusMessage: '這份分頁沒有足夠資料（需要表頭列 + 至少一列資料）' })
  }

  const headers = rows[0]!.map(h => String(h ?? '').trim())
  const dataRows = rows.slice(1)
  const cards: SheetCard[] = []
  for (const row of dataRows) {
    const card = rowToCard(headers, row)
    if (card) cards.push(card)
    if (cards.length >= GSHEET_MAX_ROWS) break
  }

  return {
    cards,
    rowCount: dataRows.length,
    truncated: dataRows.length > cards.length,
    sheetTitle,
  }
}

/**
 * 一列 → 一張卡。
 * - title：第一欄（也是自動同步比對用的 key）。空白則跳過該列。
 * - 兩欄表（問/答 FAQ）：content = 第二欄整段。
 * - 多欄表：content = 其餘各欄「表頭：值」逐行列出（空值欄略過）。
 */
export function rowToCard(headers: string[], row: string[]): SheetCard | null {
  const title = String(row[0] ?? '').trim()
  if (!title) return null

  let content: string
  if (headers.length <= 2 || row.length <= 2) {
    content = String(row[1] ?? '').trim()
  }
  else {
    const pairs: string[] = []
    for (let i = 1; i < row.length; i++) {
      const v = String(row[i] ?? '').trim()
      if (!v) continue
      const h = String(headers[i] ?? '').trim()
      pairs.push(h ? `${h}：${v}` : v)
    }
    content = pairs.join('\n')
  }

  return {
    title: title.slice(0, 200),
    // 單欄表 / 沒有其他欄位時，用標題自身當內容（validateChunkInput 要求 content 非空）
    content: (content || title).slice(0, CARD_CONTENT_MAX),
    tags: [],
  }
}
