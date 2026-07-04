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

/**
 * 單段送進 LLM 的字數上限；超過就分段切卡。
 *
 * 兩個約束一起決定這個值：
 * 1) 內容很密（近乎逐字的手冊/說明書）時一段切出的卡總量會撞 maxOutputTokens 讓輸出 JSON
 *    被截斷（Unterminated string）→ 段要夠小。
 * 2) 非同步 job 一輪只切一段；那次 LLM 呼叫必須在閘道逾時內回（否則 poll 被 504、換手重跑
 *    同一段又同樣慢 → 卡死不前進）→ 段要夠小讓輸出快。
 * 8000 字對應的輸出約 ≤12k token（配 maxOutputTokens=12288），單次呼叫約 15–25s，兩個約束都滿足。
 * 真的還是撞到截斷，由呼叫端的「對半再切」保底。
 */
export const SEGMENT_CHAR_LEN = 8_000

/** 分段合併後的總卡數上限（大型商品目錄一份可能超過單段的 50 張） */
export const MAX_TOTAL_CHUNKS = 150

/**
 * 分段切卡的並行上限。多數文件截到 MAX_RAW_TEXT_LEN(100k)後 ≤ 5 段，
 * 設 5 讓典型情況「一波」做完；設了上限（而非無腦 Promise.all）是保底：
 * 萬一未來 segment 數變多，也不會一次併發爆掉 Gemini 的速率限制。
 */
export const CHUNK_CONCURRENCY = 5

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
12. 連結：若某張卡對應的內容旁邊附有連結（原文格式為「文字（網址）」），請在該卡 content 最後**另起一行**寫「連結：<網址>」，方便客服回覆時提供。沒有附連結就不要寫這行，也**不要自己編造網址**。

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

/**
 * 對半切一段（在最近的換行邊界），保證回 ≥2 段。
 * 用於「切卡撞輸出上限（JSON 被截斷）」時把段縮小重試。
 */
export function splitSegmentInHalf(text: string): string[] {
  const t = String(text || '')
  if (t.length < 2) return [t]
  const half = Math.ceil(t.length / 2)
  const parts = segmentText(t, half)
  if (parts.length >= 2) return parts
  // 保底：segmentText 沒切開就硬切（理論上不會發生）
  return [t.slice(0, half), t.slice(half)].filter(Boolean)
}

/**
 * 是否為「輸出 JSON 被截斷」的錯誤（撞 maxOutputTokens）。
 * generateJson 對截斷的 JSON 會丟 `Gemini JSON parse failed: Unterminated ...`。
 * 這類錯誤靠「把段切小再試」可救；其它錯誤（網路 502 等）不該無限切。
 */
export function isChunkTruncationError(err: unknown): boolean {
  const msg = String((err as any)?.statusMessage || (err as any)?.message || '')
  return /JSON parse failed|Unterminated|Unexpected end|MAX_TOKENS/i.test(msg)
}

/**
 * 對「單一段」原始文字切卡。長文分段（chunkTextWithLlm）與非同步 job 狀態機
 * （ai-preview-jobs 逐段推進）共用；export 讓後者能一輪呼叫一段。
 */
export async function chunkSegment(text: string, hint: string | undefined): Promise<ChunkerResult> {
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
    // 內容密的手冊一段可切出很多卡；8192 太緊會讓輸出 JSON 截斷。給到 12288 有餘裕，
    // 但也不設更高——單次呼叫要在閘道逾時內回（見 SEGMENT_CHAR_LEN 註解）。撞到就靠對半再切。
    maxOutputTokens: 12288,
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

  // 逐段切卡改「有上限的並行」：原本是循序 await，N 段 = N×單段耗時，
  // 長文(最多 5 段)累積到 2–3 分鐘就撞 Amplify/CloudFront 的閘道逾時 → 前端看到 504。
  // 並行後 wall-clock ≈ 單段耗時。結果仍照「段序」合併/去重，輸出與原循序版一致。
  // 代價：原本一撞 MAX_TOTAL_CHUNKS 就不再呼叫後續段（省 token），並行版會先把所有段
  // 都跑完才合併，極端情況多花 1–2 段 token；用量照實入帳，換到的是不再逾時，划算。
  const results: ChunkerResult[] = new Array(segments.length)
  let nextIndex = 0
  async function worker() {
    for (let i = nextIndex++; i < segments.length; i = nextIndex++) {
      const hint = segments.length > 1
        ? `${opts?.hint ?? ''}（第 ${i + 1}/${segments.length} 段）`.trim()
        : opts?.hint
      results[i] = await chunkSegment(segments[i]!, hint)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CHUNK_CONCURRENCY, segments.length) }, () => worker()),
  )

  // 照段序合併 + 去重（同 title 留先出現的那張），維持與原循序版相同的取捨順序。
  const seenTitles = new Set<string>()
  const merged: ChunkInput[] = []
  let inputTokens = 0
  let outputTokens = 0
  for (const res of results) {
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
//  Overview（總覽卡）
//  列表頁（商品首頁、型錄頁）切碎成個別卡片後，再額外合成「一張」分類索引卡。
//  用途：接「你們有賣什麼 / 有哪些產品」這類列舉型問題 —— 個別產品卡對這種廣泛
//  提問相似度都低且接近，會誤觸反問澄清；一張帶分類結構的總覽卡能被廣泛提問
//  精準命中（靠它的 questions），top-1 衝高就直接回答。
//
//  設計：從「已切好的子卡片標題 + 重點行」合成，不重讀原文 ——
//  比再跑一次原文便宜、且保證總覽內容與實際卡片一致；長文也只餵標題不會撞 token 上限。
// ═══════════════════════════════════════════════════════════════════

const OVERVIEW_SYSTEM_INSTRUCTION = `你是專業的客服知識整理助手。任務：把一份「卡片清單」濃縮成「一張」總覽卡，讓客人問「你們有賣什麼 / 有哪些 / 全部品項」這類列舉型問題時，能用這張卡一次回答。

規則：
1. 只輸出「一張」卡，不要拆成多張。
2. 把清單裡的品項依性質歸成幾個分類（例：家電、咖啡、寵物、生活…），同類放一起。
3. content 格式：
   - 第一行以「重點：」開頭，用 ｜ 分隔各分類，每個分類後面用括號列出該類的主要品項（例：「重點：家電（循環扇、洗衣機、除濕機）｜咖啡（智慧咖啡機、手沖機）｜寵物（飲水機、清淨機）」）。
   - 留一個空行。
   - 接著用 1–3 句口語總結（例：「我們主要販售各式家電、咖啡與生活用品，想了解哪一類可以再告訴我。」），不要 markdown / 項目符號 / 表情符號。
4. 不要遺漏清單裡的主要品項；但同質、重複的可合併描述。不要捏造清單裡沒有的品項。
5. 不要出現品號、SKU、價格、編號。
6. tags：放 2–4 個分類關鍵字（例：商品總覽、產品列表）。
7. questions：寫 3–4 個客人會用來問「全部品項」的口語問句（例：「你們有賣什麼？」「有哪些產品？」「全部商品有哪些？」「有什麼推薦？」）。

輸出格式（嚴格 JSON）：
{ "title": "string", "content": "string", "tags": ["string"], "questions": ["string"] }`

/** 合成總覽卡時，每張子卡只取「標題 + 內容第一行」餵進 LLM，控制 input 量 */
function overviewSourceLine(c: ChunkInput): string {
  const firstLine = c.content.split('\n').map(s => s.trim()).find(Boolean) ?? ''
  return firstLine ? `- ${c.title}：${firstLine}` : `- ${c.title}`
}

export interface OverviewResult {
  card: ChunkInput
  inputTokens: number
  outputTokens: number
}

/**
 * 從已切好的卡片清單合成「一張」總覽卡（isOverview=true）。
 * 子卡片不足 2 張時回 null（沒必要做總覽）。失敗時 throw，由 caller 決定要不要降級。
 */
export async function summarizeAsOverviewCard(
  chunks: ChunkInput[],
  opts?: { hint?: string },
): Promise<OverviewResult | null> {
  const items = chunks.filter(c => c.title && c.content)
  if (items.length < 2) return null

  const prompt = [
    opts?.hint ? `來源：${opts.hint}` : '',
    '請把下面這份卡片清單濃縮成「一張」總覽卡：',
    '------',
    items.map(overviewSourceLine).join('\n'),
    '------',
  ].filter(Boolean).join('\n\n')

  const { data, inputTokens, outputTokens } = await generateJson<{
    title?: unknown
    content?: unknown
    tags?: unknown
    questions?: unknown
  }>(prompt, {
    systemInstruction: OVERVIEW_SYSTEM_INSTRUCTION,
    temperature: 0.2,
    maxOutputTokens: 2048,
    // 同其它結構化 JSON 任務：關掉 thinking，避免吃掉配額把 JSON 截斷
    thinkingBudget: 0,
  })

  const title = String(data?.title ?? '').trim()
  const content = String(data?.content ?? '').trim()
  if (!title || !content) return null
  const tags = Array.isArray(data?.tags)
    ? data.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 6)
    : []
  const questions = Array.isArray(data?.questions)
    ? data.questions.map(q => String(q).trim()).filter(Boolean).slice(0, 4)
    : []

  return {
    card: { title, content, tags, questions, sourceId: null, isOverview: true },
    inputTokens,
    outputTokens,
  }
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
