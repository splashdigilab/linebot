/**
 * 用 Gemini Flash 把一份原始文件切成多張獨立知識卡。
 *
 * 設計重點：
 * - 一卡一主題；標題要簡短、內容講人話、不要 markdown
 * - 每張卡附 2–3 個「常見問法」：客人是用問句提問、卡片是敘述句，
 *   把問句一起 embed 能顯著拉高 query-card 相似度
 * - 忽略目錄、頁碼、版權聲明等沒實質內容的段落
 * - 強制 JSON 輸出（responseMimeType=application/json）
 * - 長文分段：單段過長會讓輸出 JSON 撞到 maxOutputTokens 被截斷（整次匯入歸零），
 *   所以超過 SEGMENT_CHAR_LEN 就切段、逐段呼叫再合併
 */
import { generateJson } from './gemini'
import type { ChunkInput } from './ai-knowledge-chunks'

export const MAX_CHUNKS_PER_DOC = 50

/** 單段送進 LLM 的字數上限；超過就分段切卡 */
export const SEGMENT_CHAR_LEN = 20_000

/** 分段合併後的總卡數上限（大型商品目錄一份可能超過單段的 50 張） */
export const MAX_TOTAL_CHUNKS = 150

const SYSTEM_INSTRUCTION = `你是專業的客服知識整理助手。任務：把使用者提供的原始文件切成獨立的「知識卡」，並讓每張卡對 AI 檢索 / 回答都最友善。

規則：
1. 一張卡聚焦一個主題（一卡一事）。不同主題就切開、相同主題就合併。
2. 標題簡短（不超過 20 字）、能讓人一眼看懂主題（例：「退換貨政策」、「運費說明」）。
3. 標題裡不要放品號、SKU、訂單編號等系統識別碼。
4. content 的格式：
   - 第一行：以「重點：」開頭，用 ｜ 分隔 3–6 個關鍵屬性（例：「重點：產地：巴拿馬｜處理：日曬｜烘焙：黃金｜主調：花香、白桃、藍莓」）。
   - 留一個空行。
   - 接著用完整句子的口語說明，不要 markdown / 項目符號 / 表情符號 / 敬語贅詞。
   - 如果整段內容沒有任何結構化屬性可以抽（例如純流程說明），則省略「重點：」行，直接寫敘述。
5. content **不要**出現品號、SKU、產品編號、訂單編號等系統識別碼；如果這些是該卡的核心識別資訊，請放到 tags（例：「品號21070906」）。
6. 內容要包含「客服回答時需要知道的完整資訊」，但去掉廢話 / 客套語 / 廣告詞。
7. 標籤從內容歸納 2–4 個關鍵字（例：售後、運費、會員）。
8. questions：為每張卡寫 2–3 個「客人實際會怎麼問」的口語問句（例：「運費怎麼算？」「多久會到貨？」）。用客人的字眼、不要照抄卡片標題。
9. 忽略：目錄、頁碼、版權聲明、廣告、聯絡資訊樣板、純圖片標註。
10. 若整份文件都沒實質內容，回傳空陣列。
11. 最多輸出 50 張卡。

輸出格式（嚴格 JSON）：
{
  "chunks": [
    { "title": "string", "content": "string", "tags": ["string", "string"], "questions": ["string", "string"] }
  ]
}`

interface ChunkerJsonResponse {
  chunks?: Array<{ title?: unknown; content?: unknown; tags?: unknown; questions?: unknown }>
}

export interface ChunkerResult {
  chunks: ChunkInput[]
  inputTokens: number
  outputTokens: number
}

/**
 * 把長文按段落邊界切成 ≤ SEGMENT_CHAR_LEN 的片段。
 * 切點往前找最近的換行，避免把一個主題從中間劈開；整段沒換行就硬切。
 */
export function segmentText(text: string, segmentLen = SEGMENT_CHAR_LEN): string[] {
  if (text.length <= segmentLen) return [text]
  const segments: string[] = []
  let rest = text
  while (rest.length > segmentLen) {
    const slice = rest.slice(0, segmentLen)
    const lastBreak = slice.lastIndexOf('\n')
    // 換行太前面（< 50%）代表這段幾乎沒段落結構，硬切比丟掉一半好
    const cut = lastBreak > segmentLen * 0.5 ? lastBreak : segmentLen
    segments.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) segments.push(rest)
  return segments.filter(Boolean)
}

async function chunkSegment(text: string, hint: string | undefined): Promise<ChunkerResult> {
  const prompt = [
    hint ? `來源提示：${hint}` : '',
    '請依照規則把以下原始文件切成知識卡：',
    '------',
    text,
    '------',
  ].filter(Boolean).join('\n\n')

  const { data, inputTokens, outputTokens } = await generateJson<ChunkerJsonResponse>(prompt, {
    systemInstruction: SYSTEM_INSTRUCTION,
    temperature: 0.2,
    maxOutputTokens: 8192,
    // thinking 會吃掉 maxOutputTokens 配額，讓 JSON 寫到一半被截斷（Unterminated string）。
    // 切卡不需要深度思考，關掉把整個配額留給輸出。
    thinkingBudget: 0,
  })

  const rawChunks = Array.isArray(data?.chunks) ? data.chunks : []
  const chunks: ChunkInput[] = []
  for (const raw of rawChunks.slice(0, MAX_CHUNKS_PER_DOC)) {
    const title = String(raw?.title ?? '').trim()
    const content = String(raw?.content ?? '').trim()
    const tags = Array.isArray(raw?.tags)
      ? raw.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 6)
      : []
    const questions = Array.isArray(raw?.questions)
      ? raw.questions.map(q => String(q).trim()).filter(Boolean).slice(0, 3)
      : []
    if (!title || !content) continue
    chunks.push({ title, content, tags, questions, sourceId: null })
  }

  return { chunks, inputTokens, outputTokens }
}

/**
 * 把原始純文字交給 Gemini 切成知識卡。
 * 超過 SEGMENT_CHAR_LEN 自動分段逐段切卡再合併（同 title 留第一張）。
 * 失敗會 throw（讓上層決定要不要降級成「整包當一張卡」）；
 * 分段模式下單段失敗就整體 throw——寧可重來也不要默默少一段。
 */
export async function chunkTextWithLlm(rawText: string, opts?: { hint?: string }): Promise<ChunkerResult> {
  const text = String(rawText || '').trim()
  if (!text) return { chunks: [], inputTokens: 0, outputTokens: 0 }

  const segments = segmentText(text)
  const seenTitles = new Set<string>()
  const merged: ChunkInput[] = []
  let inputTokens = 0
  let outputTokens = 0

  for (let i = 0; i < segments.length; i++) {
    const hint = segments.length > 1
      ? `${opts?.hint ?? ''}（第 ${i + 1}/${segments.length} 段）`.trim()
      : opts?.hint
    const res = await chunkSegment(segments[i]!, hint)
    inputTokens += res.inputTokens
    outputTokens += res.outputTokens
    for (const c of res.chunks) {
      const key = c.title.replace(/\s+/g, '')
      if (seenTitles.has(key)) continue
      seenTitles.add(key)
      merged.push(c)
      if (merged.length >= MAX_TOTAL_CHUNKS) break
    }
    if (merged.length >= MAX_TOTAL_CHUNKS) break
  }

  return { chunks: merged, inputTokens, outputTokens }
}

// ═══════════════════════════════════════════════════════════════════
//  Normalize（單卡整理）
//  既有卡 / 手打卡用同樣的 system instruction 跑一次，把它變成標準格式：
//    - 第一行「重點：」keyword 摘要
//    - 移除品號 / 編號
//    - 內文重寫成口語完整句
// ═══════════════════════════════════════════════════════════════════

const NORMALIZE_SYSTEM_INSTRUCTION = `你是專業的客服知識整理助手。任務：把使用者提供的「單一張知識卡」重新整理成標準格式，**不要切成多張**。

規則：
1. 保持是一張卡（不要拆）；輸出一個 chunk 物件。
2. 標題保留主要識別資訊，但移除品號、SKU、訂單編號等系統識別碼；長度不超過 20 字。
3. content 的格式：
   - 第一行：以「重點：」開頭，用 ｜ 分隔 3–6 個關鍵屬性（例：「重點：產地：巴拿馬｜處理：日曬｜烘焙：黃金｜主調：花香、白桃、藍莓」）。
   - 留一個空行。
   - 接著用完整句子的口語說明，不要 markdown / 項目符號 / 表情符號 / 敬語贅詞。
   - 若原文已有「重點：」開頭，請替換為新版，不要疊加。
   - 如果沒有任何結構化屬性可抽（純流程說明等），則省略「重點：」行，直接寫敘述。
4. content 不要包含品號、SKU 等系統識別碼；若這些是核心識別，請放到 tags。
5. 保留所有有意義的事實資訊；不要漏資訊、不要加你自己編的內容。
6. 標籤盡量沿用原本的、需要時補充 1–2 個新標籤，總共 2–6 個。
7. questions：寫 2–3 個「客人實際會怎麼問」的口語問句，用客人的字眼、不要照抄標題。

輸出格式（嚴格 JSON）：
{ "title": "string", "content": "string", "tags": ["string"], "questions": ["string"] }`

export interface NormalizeResult {
  title: string
  content: string
  tags: string[]
  questions: string[]
  inputTokens: number
  outputTokens: number
}

/**
 * 對單張卡跑 LLM 整理，回傳整理後的 title / content / tags。
 * 失敗時 throw；caller 自行決定要不要降級成「保留原本不動」。
 */
export async function normalizeChunkWithLlm(input: {
  title: string
  content: string
  tags: string[]
}): Promise<NormalizeResult> {
  const prompt = [
    '請依規則整理這張知識卡：',
    '------',
    `[原標題] ${input.title}`,
    `[原標籤] ${input.tags.join('、') || '（無）'}`,
    '[原內容]',
    input.content,
    '------',
  ].join('\n')

  const { data, inputTokens, outputTokens } = await generateJson<{
    title?: unknown
    content?: unknown
    tags?: unknown
    questions?: unknown
  }>(prompt, {
    systemInstruction: NORMALIZE_SYSTEM_INSTRUCTION,
    temperature: 0.2,
    maxOutputTokens: 4096,
    // 同 chunkSegment：關掉 thinking，避免吃掉配額把 JSON 截斷。
    thinkingBudget: 0,
  })

  const title = String(data?.title ?? '').trim() || input.title
  const content = String(data?.content ?? '').trim()
  const tags = Array.isArray(data?.tags)
    ? data.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 6)
    : input.tags
  const questions = Array.isArray(data?.questions)
    ? data.questions.map(q => String(q).trim()).filter(Boolean).slice(0, 3)
    : []

  if (!content) {
    throw createError({ statusCode: 502, statusMessage: 'normalize: LLM 回傳的 content 為空' })
  }

  return { title, content, tags, questions, inputTokens, outputTokens }
}
