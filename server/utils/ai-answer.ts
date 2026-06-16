/**
 * AI 答題主流程（RAG）。三道護欄：敏感詞 → grounding → 信心；外加 disambiguation 分支。
 *
 * 注意：是否「啟用 AI 自動回覆」(settings.enabled) 由 caller 判斷；本函式不再 gate，
 * 讓 playground 可以在尚未啟用正式自動回覆時做試答。
 *
 * 流程：
 *   1. 敏感詞掃描（命中 → handoff: sensitive_topic）
 *   2. quota 檢查（超量且 strategy=handoff_all → handoff: quota_exceeded；
 *                  若 strategy=downgrade_model 則改用 flash-lite 並繼續）
 *   3. embed query → 向量搜尋 top-K
 *   4. disambiguation 偵測（先於 grounding）：top-1 在擦邊區 + top-1 / top-2 差距小
 *      → 反問澄清；caller 可用 skipDisambiguation 短路（cooldown / followup）。
 *      設計理由：「多卡同樣相關」是比 grounding 更強的訊號，即使 top-1 略低於 grounding
 *      門檻也應主動反問，不要默默 handoff。
 *   5. grounding：top-1 similarity < 門檻 → handoff: no_grounding
 *   6. LLM 生成回答（用知識卡內容當 context）
 *   7. confidence：使用 top-1 similarity 作為信心；< confidenceThreshold → handoff: low_confidence
 *   8. 否則 → answered，回傳 answer + sources
 */
import { searchChunksByIdentifierTag, searchSimilarChunks, type SimilarChunk } from './ai-knowledge-chunks'
import { getCatalogSourceIds } from './ai-knowledge-sources'
import { embedQuery, estimateTokens, generateJson } from './gemini'
import { getAiSettings, getGroundingThreshold } from './ai-settings'
import { getCurrentMonthTokens, recordAiUsage } from './ai-usage'
import { getDb } from './firebase'
import {
  DEFAULT_TOP_K_CHUNKS,
  detectSensitiveTopic,
} from '~~/shared/types/ai-knowledge'
import type {
  AiAnswerResult,
  AiSettingsDoc,
  DisambiguationPayload,
  HandoffReason,
} from '~~/shared/types/ai-knowledge'

export interface AiChatTurn {
  role: 'user' | 'bot'
  text: string
}

/**
 * 進 prompt 的單卡內容上限。top-K 全文最壞 ~25k 字只為生 300 字回答，
 * 大多是浪費的 input token；卡片重點都在前段（「重點：」行 + 前幾句）。
 */
const CONTEXT_CARD_MAX_CHARS = 800

export interface AnswerInput {
  workspaceId: string
  query: string
  /**
   * 最近對話（最舊在前、不含本次 query）。用途：
   *   1. 追問補救檢索——「那運費呢？」這類缺主題的短句，單句 embedding 撈不到卡時，
   *      併上一輪客人訊息重新檢索一次
   *   2. 生成回答時帶入對話脈絡，避免答非所問
   */
  history?: AiChatTurn[]
  /** Playground 用：回傳更多 debug 資訊 */
  debug?: boolean
  /** Caller 指示跳過 disambiguation（例：同對話 cooldown 期間） */
  skipDisambiguation?: boolean
  /** Followup 模式：客人點按鈕後重跑，不要再計 invocation */
  isFollowup?: boolean
}

/**
 * 純社交語句（招呼 / 道謝 / 道別）偵測 + 罐頭回覆。命中就不走 RAG ——
 * 這類話語意上跟產品卡勉強沾邊（~0.6），硬走 RAG 會讓 bot「附身」成某產品
 * （回「我是小獴友」）或對「謝謝」直接 handoff 轉真人。
 * 刻意收得很緊（去標點後需整句等於該語句、且 ≤ 8 字），避免誤攔
 * 「你好我想問除濕機」「謝謝但這個多少錢」這種帶實際問題的句子。
 * 全部租戶中立；之後要客製可改成 per-workspace 設定。
 */
const GREETING_RE = /^(hi+|hello+|hey+|嗨+|哈囉+|哈摟+|你好|妳好|您好|安安|早安|午安|晚安|在嗎|有人嗎|請問有人嗎)$/i
const THANKS_RE = /^(謝謝你?|謝謝啦|謝謝喔|感謝你?|感恩|多謝|thanks?|thankyou|thx|3q)$/i
const FAREWELL_RE = /^(掰掰|拜拜|再見|bye+|byebye|seeyou)$/i

export const DEFAULT_GREETING_REPLY = '您好，請問有什麼可以為您服務的嗎？😊'
export const DEFAULT_THANKS_REPLY = '不客氣！還有需要都可以再跟我說 😊'
export const DEFAULT_FAREWELL_REPLY = '再見，有需要再來找我喔！😊'

/** 社交意圖 → 罐頭回覆；非社交回 null。intent router 與 regex fallback 共用。 */
export function socialReplyForIntent(intent: MessageIntent): string | null {
  if (intent === 'greeting') return DEFAULT_GREETING_REPLY
  if (intent === 'thanks') return DEFAULT_THANKS_REPLY
  if (intent === 'farewell') return DEFAULT_FAREWELL_REPLY
  return null
}

/**
 * Regex fallback：intent router 失敗（LLM 逾時 / 429）時用，沿用收緊的關鍵字判斷。
 * 命中社交語句回對應罐頭回覆；否則回 null（續走 RAG）。
 */
export function socialCannedReply(text: string): string | null {
  const t = String(text || '').trim().replace(/[!！。.~～、,，?？\s]/g, '')
  if (!t || t.length > 8) return null
  if (GREETING_RE.test(t)) return DEFAULT_GREETING_REPLY
  if (THANKS_RE.test(t)) return DEFAULT_THANKS_REPLY
  if (FAREWELL_RE.test(t)) return DEFAULT_FAREWELL_REPLY
  return null
}

// ═══════════════════════════════════════════════════════════════════
//  Intent router（意圖路由）
//  開頭跑一次 flash-lite 分類，跟 embedQuery 並行 → 幾乎不增加延遲。
//  用「整句語意」判斷意圖,解決關鍵字「列不完」與「謝謝但後面還有問題」的問題。
//  失敗回 null,呼叫端 fallback 回 regex / heuristic,不會整題掛掉。
//  通用、不綁租戶；敏感詞另由 detectSensitiveTopic 關鍵字硬擋,這裡只是語意補抓。
// ═══════════════════════════════════════════════════════════════════

export type MessageIntent = 'greeting' | 'thanks' | 'farewell' | 'find_human' | 'sensitive' | 'compare' | 'question'

export interface IntentResult {
  intent: MessageIntent
  /** 這句是否「沒有上一輪就看不懂」（多少錢 / 可以無線充電嗎 = true；除濕機多少錢 = false） */
  isFollowup: boolean
  inputTokens: number
  outputTokens: number
}

const VALID_INTENTS: MessageIntent[] = ['greeting', 'thanks', 'farewell', 'find_human', 'sensitive', 'compare', 'question']

const INTENT_SYSTEM_INSTRUCTION = `你是客服訊息分類器。讀客人這句話，判斷「意圖」與「是否依賴上一輪」。

intent 擇一：
- greeting：純打招呼（你好、嗨、在嗎、早安）
- thanks：純道謝（謝謝、感謝、感恩、3Q）
- farewell：純道別（掰掰、再見、bye）
- find_human：明確要求真人 / 客服專員（我要找真人、轉接專員、要跟人講）
- sensitive：涉及退費退款、法律糾紛、醫療診斷、投資建議、個資外洩 等需真人處理的敏感情境
- compare：想「比較多個產品 / 在多個之間挑選」（例「A 跟 B 哪個好」「這幾台比一下」「差在哪」「A vs B」「哪台比較適合我」）
- question：其他一般詢問——針對「單一主題」的產品、規格、價格、運費、流程、用法等

重要：
- 若一句話同時有社交詞與實際問題（例「謝謝，但我想問運費」「你好，這台多少錢」），以實際問題為準 → question。
- 只有「真的在打招呼 / 道謝 / 道別」才歸 greeting / thanks / farewell。**單獨的產品名、品牌、品類、型號（例「小獴友」「除濕機」「ibarista」「LG小蘑菇」）不是社交語句，一律 → question。**

isFollowup：這句話是否「脫離上一輪對話就看不懂在問什麼」。
- 「多少錢」「可以無線充電嗎」「那這個呢」「有貨嗎」→ true
- 「除濕機多少錢」「你們有賣什麼」「小獴友怎麼連wifi」自帶主題 → false

回傳 JSON：{ "intent": "...", "isFollowup": true/false }`

/**
 * 用 flash-lite 對訊息做意圖分類。失敗回 null（呼叫端 fallback）。
 * 帶最近 2 則對話讓它判 isFollowup。
 */
export async function classifyIntent(text: string, history?: AiChatTurn[]): Promise<IntentResult | null> {
  const recent = (history ?? []).slice(-2)
    .map(t => `${t.role === 'user' ? '客人' : '客服'}：${t.text.trim().slice(0, 120)}`)
    .join('\n')
  const prompt = [
    recent ? `【最近對話】\n${recent}` : '',
    `【客人這句】\n${text}`,
  ].filter(Boolean).join('\n\n')

  try {
    const { data, inputTokens, outputTokens } = await generateJson<{ intent?: unknown; isFollowup?: unknown }>(prompt, {
      systemInstruction: INTENT_SYSTEM_INSTRUCTION,
      temperature: 0,
      maxOutputTokens: 80,
      model: 'gemini-2.5-flash-lite',
      thinkingBudget: 0,
    })
    const intent = VALID_INTENTS.includes(data?.intent as MessageIntent)
      ? (data!.intent as MessageIntent)
      : 'question'
    return { intent, isFollowup: data?.isFollowup === true, inputTokens, outputTokens }
  }
  catch (err) {
    console.warn('[ai-answer] classifyIntent failed, fallback to heuristics:', err)
    return null
  }
}

/**
 * 「依賴上下文的追問」偵測：只問屬性、沒帶產品主題的短句
 * （價格 / 庫存 / 用法 / 規格 / 指代詞）。命中代表這句話本身撈不準，要靠上一輪鎖主題。
 * 刻意只認「屬性詞 / 指代詞」而不靠長度——「空氣清淨機有什麼」雖短但有主題詞，不該被當追問
 * 去併上下文（會把它從『精準反問某類』拉歪成『答總覽』）。
 */
const FOLLOWUP_MARKERS = /多少錢|價格|價錢|售價|怎麼賣|有沒有貨|有貨|現貨|缺貨|何時|什麼時候|出貨|怎麼用|怎麼操作|如何使用|規格|顏色|尺寸|重量|材質|保固|多重|多大|多久|這個|那個|這款|那款|這台|那台|它|哪裡買/

export function isContextDependentFollowup(text: string): boolean {
  return FOLLOWUP_MARKERS.test(String(text || ''))
}

/** 短於此長度的提問一律當追問、併上一輪重檢索（取 max，誤併也不會拉低）。 */
export const FOLLOWUP_MAX_LEN = 12

/**
 * 把「主題錨點 → 本次提問」這串併起來，給追問補救檢索用。
 *
 * 多輪斷鏈修正（D-2）：不是只併「前一句」——往回找到最後一句「自帶主題」(非追問)的
 * 客人訊息當錨點，再把錨點之後到現在的所有客人訊息接起來。
 * 例：「奇美的燈」→「保固多久」→「怎麼申請」，第三句會併成
 *    「奇美的燈\n保固多久\n怎麼申請」，主題不會在第二跳就掉。
 * 若往回全是追問句（找不到錨點），退回只併前一句（舊行為）。
 * 沒有可用的上一輪（無 history、只剩本次）回 null。
 */
export function buildContextualQuery(
  history: AiChatTurn[] | undefined,
  current: string,
): string | null {
  if (!history?.length) return null
  const cur = current.trim()
  const userTurns = history
    .filter(t => t.role === 'user' && t.text.trim() && t.text.trim() !== cur)
    .map(t => t.text.trim())
  if (!userTurns.length) return null

  // 用「關鍵字追問」判斷哪句是追問（不靠長度——「奇美的燈」短但自帶主題，不該被當追問跳過）
  let anchorIdx = -1
  for (let i = userTurns.length - 1; i >= 0; i--) {
    if (!isContextDependentFollowup(userTurns[i]!)) { anchorIdx = i; break }
  }
  const start = anchorIdx >= 0 ? anchorIdx : userTurns.length - 1
  return [...userTurns.slice(start), cur].join('\n').slice(0, 1000)
}

export interface AnswerOutput extends AiAnswerResult {
  /** Playground 用 */
  debugPrompt?: string
}

function handoff(reason: HandoffReason, sources: SimilarChunk[] = []): AnswerOutput {
  return {
    decision: 'handoff',
    answer: '',
    // 帶 top-1 similarity，方便 playground 看擦邊 case（沒有 sources 時為 0）
    confidence: sources[0]?.similarity ?? 0,
    sources: sources.map(s => ({ chunkId: s.id, title: s.title, similarity: s.similarity })),
    handoffReason: reason,
  }
}

/**
 * 把答案壓在 maxLen 字以內，且**永不超出、不切在字中間**：
 *   - 沒超長 → 原樣回傳
 *   - 超長 → 往**前**找 maxLen 之內最後一個句末符號（。！？\n），切到那裡（會丟掉最後不完整那句）
 *   - 真的找不到句末（整段沒有任何句點）→ 硬切並補「…」
 * 與舊版差異：絕對不會輸出超過 maxLen 字的內容（除了「…」算 1 字）。
 */
export function truncateAtSentence(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text

  // 只在 maxLen 之內找句末，不要往後越界
  const sliced = text.slice(0, maxLen)
  const lastBoundary = Math.max(
    sliced.lastIndexOf('。'),
    sliced.lastIndexOf('！'),
    sliced.lastIndexOf('？'),
    sliced.lastIndexOf('\n'),
  )
  if (lastBoundary > 0) {
    return text.slice(0, lastBoundary + 1).trim()
  }

  // 退路：整段沒一個句末（LLM 沒斷句）→ 硬切並標示
  return `${text.slice(0, maxLen - 1).trim()}…`
}

/**
 * 同 sourceId 只留分數最高那張；無 sourceId 的卡視為各自獨立。結果保持由高到低順序。
 *
 * exemptSourceIds：「型錄/列表來源」(generateOverview) 的 sourceId —— 這類來源旗下是**不同產品**
 * 共用同一 sourceId，不能當「同主題」併掉（否則「有沒有除濕機」只剩 1 個產品、其餘被雜卡填位）。
 * 列在豁免集合的卡視為各自獨立、全部保留；近似重複仍由 dedupeNearIdentical 處理。
 */
export function dedupeBySource(chunks: SimilarChunk[], exemptSourceIds?: Set<string>): SimilarChunk[] {
  const seen = new Set<string>()
  const out: SimilarChunk[] = []
  for (const c of chunks) {
    const key = c.sourceId
    if (!key || exemptSourceIds?.has(key)) {
      out.push(c)
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

/**
 * 跨來源重複卡去重：同一份內容被兩個來源各匯入一次時，兩張卡相似度幾乎相等，
 * 會誤觸 disambiguation（top1−top2 < spread）反問客人「你要 A 還是 A？」。
 * 標題或內容正規化後相同即視為重複，保留排前面（分數較高）那張。
 */
export function dedupeNearIdentical(chunks: SimilarChunk[]): SimilarChunk[] {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  const seenTitles = new Set<string>()
  const seenContents = new Set<string>()
  const out: SimilarChunk[] = []
  for (const c of chunks) {
    const t = norm(c.title)
    const body = norm(c.content)
    if ((t && seenTitles.has(t)) || (body && seenContents.has(body))) continue
    if (t) seenTitles.add(t)
    if (body) seenContents.add(body)
    out.push(c)
  }
  return out
}

/**
 * 「通用主題卡」標記：說明 / 政策 / 出貨 / 抽獎 / 流程這類**非產品**卡。
 * 反問選項應優先呈現實際產品，不要塞「現貨庫存說明」「出廠測試現象」這種給客人選。
 */
const GENERIC_TOPIC_RE = /說明|政策|辦法|聲明|提醒|查詢|進度|出貨|抽獎|測試|現象|聯絡|客服|統編|發票|退稅|退還|認證|價格調整/

/**
 * 穩定排序：把通用主題卡排到產品卡之後（同組內維持原相似度順序）。
 * 只在「產品卡與主題卡並存」時改變選項；若候選全是主題卡（例「保固多久」）順序不變。
 */
export function preferProductCards(chunks: SimilarChunk[]): SimilarChunk[] {
  const isGeneric = (c: SimilarChunk) => GENERIC_TOPIC_RE.test(c.title)
  return [...chunks].sort((a, b) => Number(isGeneric(a)) - Number(isGeneric(b)))
}

/**
 * 同產品變體卡去重（D-3）：同一個產品被多來源匯入（首頁 + FAQ）會產生標題略異的卡
 * （「NWT 16L高效抽取型除濕機」vs「…除濕機專案資訊」），dedupeNearIdentical 抓不到。
 * 這裡用「標題去空白後互為前綴/包含」判同產品，保留排前面（分數高）那張。
 * 較短標題需 ≥ 4 字才比對，避免「燈」這類短詞誤吃掉不同產品。不同型號（高效 vs AI）不會被併。
 */
export function dedupeByTitleContainment(chunks: SimilarChunk[]): SimilarChunk[] {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  const kept: Array<{ chunk: SimilarChunk; key: string }> = []
  for (const c of chunks) {
    const key = norm(c.title)
    const dup = kept.some(({ key: k }) => {
      const shorter = key.length <= k.length ? key : k
      const longer = key.length <= k.length ? k : key
      return shorter.length >= 4 && longer.includes(shorter)
    })
    if (!dup) kept.push({ chunk: c, key })
  }
  return kept.map(k => k.chunk)
}

/**
 * 判斷是否進入 disambiguation 分支。
 * 條件：top-1 ∈ [top1Min, top1Max)，(top1 − top2) < maxSpread，dedupe 後至少 2 張。
 */
export function shouldDisambiguate(
  dedupedChunks: SimilarChunk[],
  settings: Pick<AiSettingsDoc, 'disambiguation'>,
): boolean {
  const cfg = settings.disambiguation
  if (!cfg.enabled) return false
  const [a, b] = dedupedChunks
  if (!a || !b) return false
  // top-1 命中「總覽卡」：客人問的是列舉型問題（你們有賣什麼），總覽卡贏了本身就是答案，
  // 不該再反問「你要哪一個」。直接放行去 answer。
  if (a.isOverview) return false
  const top1 = a.similarity
  const top2 = b.similarity
  if (top1 < cfg.top1Min || top1 >= cfg.top1Max) return false
  return (top1 - top2) < cfg.maxSpread
}

/**
 * 請 LLM 生成反問澄清語句 + 從 candidates 中挑出選項。
 * 強制走 JSON 模式；任何不在白名單裡的 title 都會被過濾。
 * 過濾後若 options < 2，回 null 讓主流程退回正常 answer。
 */
/**
 * 把 LLM 回的「可能略簡化的標題」對應回原 candidate。
 * 比對策略由嚴到鬆：完全相等 > 雙向 startsWith > 雙向 includes。
 * 找不到就回 null（被過濾）。
 */
export function matchCandidateTitle(llmTitle: string, candidates: SimilarChunk[]): SimilarChunk | null {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  const target = norm(llmTitle)
  if (!target) return null

  // 1. exact
  const exact = candidates.find(c => norm(c.title) === target)
  if (exact) return exact

  // 2. prefix（雙向，例：LLM 回 "巴拿馬 藝伎 水洗" / 卡名 "巴拿馬 藝伎 水洗 (品號:21070909)"）
  const prefix = candidates.find((c) => {
    const candidate = norm(c.title)
    return candidate.startsWith(target) || target.startsWith(candidate)
  })
  if (prefix) return prefix

  // 3. contains（最後手段；雙向）
  const contains = candidates.find((c) => {
    const candidate = norm(c.title)
    return candidate.includes(target) || target.includes(candidate)
  })
  return contains ?? null
}

async function generateDisambiguation(
  candidates: SimilarChunk[],
  query: string,
  settings: AiSettingsDoc,
): Promise<{ payload: DisambiguationPayload; inputTokens: number; outputTokens: number } | null> {
  const titlesList = candidates.map((c, i) => `${i + 1}. ${c.title}`).join('\n')

  const prompt = [
    '客人問的問題太籠統，知識庫有多張卡可能都相關。',
    '請生成一句反問，幫客人澄清想了解哪一張卡的內容；並從下方候選清單裡挑出實際要呈現的選項。',
    '',
    '【候選卡片標題（你只能從這裡選 option）】',
    titlesList,
    '',
    '【客人提問】',
    query,
    '',
    '回傳 JSON：{ "clarification": string, "options": [{ "title": string, "label": string }] }',
    '',
    '【clarification 規則】',
    `- 控制在 50 字內、自然口語、不要疊敬語（不要「您好」「請問」開頭）。`,
    `- 只能描述「客人有哪些選項可選」，不要捏造客人沒提過的細節，不要報品號 / 編號。`,
    `- 不要直接列出全部選項名稱，按鈕自會顯示；只需引導客人做選擇即可。`,
    '',
    '【options 規則】',
    `- 最多 ${settings.disambiguation.maxOptions} 個，順序依與客人問題的相關度由高到低排。`,
    `- title：必須是上方候選清單裡的「完整原文標題」（不可改寫、不可截斷、不可翻譯）。`,
    `- label：給按鈕顯示的短名稱，**12 字以內**，保留最能區分選項的字眼（去掉品號、括號附註）。`,
  ].join('\n')

  try {
    const res = await generateJson<{ clarification?: unknown; options?: unknown; optionTitles?: unknown }>(prompt, {
      systemInstruction: settings.systemPrompt,
      temperature: 0.3,
      maxOutputTokens: 512,
      // 反問澄清是簡單任務（選標題 + 一句話），固定用 flash-lite 即可，不跟著 answerModel
      model: 'gemini-2.5-flash-lite',
      // 512 cap 很緊，thinking 一吃就截斷 JSON；簡單任務直接關
      thinkingBudget: 0,
    })
    const clarification = String(res.data?.clarification ?? '').trim()
    // 新格式 options:[{title,label}]；舊格式 optionTitles:string[] 保留相容（LLM 偶爾不照新 schema）
    const rawOptions: Array<{ title: string; label: string }> = Array.isArray(res.data?.options)
      ? res.data.options.map((o: any) => ({
          title: String(o?.title ?? '').trim(),
          label: String(o?.label ?? '').trim(),
        }))
      : (Array.isArray(res.data?.optionTitles) ? res.data.optionTitles : [])
          .map((t: unknown) => ({ title: String(t ?? '').trim(), label: '' }))

    // 用 fuzzy 比對映射回原 candidate，避免 LLM 簡化標題（去掉品號 / 多空白）就被全砍
    const matched: Array<{ chunk: SimilarChunk; label: string }> = []
    const seenIds = new Set<string>()
    for (const raw of rawOptions) {
      if (!raw.title) continue
      const chunk = matchCandidateTitle(raw.title, candidates)
      if (!chunk || seenIds.has(chunk.id)) continue
      seenIds.add(chunk.id)
      matched.push({ chunk, label: raw.label })
      if (matched.length >= settings.disambiguation.maxOptions) break
    }

    if (!clarification || matched.length < 2) return null

    const options = matched.map(m => ({
      chunkId: m.chunk.id,
      title: m.chunk.title,
      // label 給按鈕顯示；LLM 沒給就退回截標題
      label: m.label || m.chunk.title.slice(0, 20),
    }))

    return {
      payload: { clarification, options },
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
    }
  }
  catch (err) {
    console.error('[ai-answer] generateDisambiguation failed:', err)
    return null
  }
}

/**
 * 主要答題函式。同步流程；不直接寫對話訊息（呼叫方自己決定要 reply 還是 push）。
 */
export async function answerWithAi(input: AnswerInput): Promise<AnswerOutput> {
  const { workspaceId, query } = input
  const text = String(query || '').trim()
  if (!text) return handoff('manual')

  const db = getDb()
  const settings = await getAiSettings(workspaceId, db)

  // ── 1. 敏感詞護欄 ──────────────────────────────────────
  const hit = detectSensitiveTopic(text, settings.sensitiveTopics)
  if (hit) {
    if (!input.isFollowup) {
      await recordAiUsage(workspaceId, { invocations: 1, handoffs: 1 }, db)
    }
    return handoff('sensitive_topic')
  }

  // ── 2. quota 護欄 ────────────────────────────────────────
  // 放在 router/embed 之前：超量且 handoff_all 時不要再花 LLM。
  // 注意：「先讀用量再答題、答完才記帳」並非嚴格原子——併發訊息可能讓當月用量
  // 略為超過 cap（誤差約為同時在途的幾次呼叫）。cap 是軟性護欄，可接受此誤差。
  let answerModel = settings.answerModel
  if (settings.quota.monthlyTokenCap > 0) {
    const used = await getCurrentMonthTokens(workspaceId, db)
    if (used >= settings.quota.monthlyTokenCap) {
      if (settings.quota.onExceed === 'handoff_all') {
        if (!input.isFollowup) {
          await recordAiUsage(workspaceId, { invocations: 1, handoffs: 1 }, db)
        }
        return handoff('quota_exceeded')
      }
      // downgrade_model：改用更便宜的 flash-lite，繼續答
      answerModel = 'gemini-2.5-flash-lite'
    }
  }

  // ── 3. 意圖路由 ∥ 向量檢索（並行，延遲幾乎不增加）──────────
  // classifyIntent 用整句語意判斷意圖（解決關鍵字列不完 / 「謝謝但後面有問題」），
  // 與 embedQuery 同時跑；classifyIntent 失敗回 null，fallback 回 regex/heuristic。
  let intentRes: IntentResult | null
  let queryVector: number[]
  try {
    const [ir, qv] = await Promise.all([
      classifyIntent(text, input.history),
      embedQuery(text),
    ])
    intentRes = ir
    queryVector = qv
  }
  catch (err) {
    console.error('[ai-answer] embedQuery failed:', err)
    if (!input.isFollowup) {
      await recordAiUsage(workspaceId, { invocations: 1, handoffs: 1 }, db)
    }
    return handoff('llm_error')
  }
  const routerIn = intentRes?.inputTokens ?? 0
  const routerOut = intentRes?.outputTokens ?? 0

  // ── 3.5 意圖分流（router 失敗則用 regex/heuristic fallback）──
  // 語意敏感（關鍵字漏抓的換句話說）→ 轉真人。關鍵字硬擋已在步驟 1 做過，這裡是補抓。
  if (intentRes?.intent === 'sensitive') {
    if (!input.isFollowup) {
      await recordAiUsage(workspaceId, { invocations: 1, handoffs: 1, inputTokens: routerIn, outputTokens: routerOut }, db)
    }
    return handoff('sensitive_topic')
  }
  // 明確要求真人
  if (intentRes?.intent === 'find_human') {
    if (!input.isFollowup) {
      await recordAiUsage(workspaceId, { invocations: 1, handoffs: 1, inputTokens: routerIn, outputTokens: routerOut }, db)
    }
    return handoff('user_request')
  }
  // 社交（招呼 / 道謝 / 道別）→ 罐頭，不走 RAG
  const social = intentRes ? socialReplyForIntent(intentRes.intent) : socialCannedReply(text)
  if (social) {
    if (!input.isFollowup) {
      await recordAiUsage(workspaceId, { invocations: 1, answered: 1, inputTokens: routerIn, outputTokens: routerOut }, db)
    }
    return { decision: 'answered', answer: social, confidence: 1, sources: [], handoffReason: null }
  }

  // 比較意圖：客人想比較多個產品。**不要反問叫他選一個**（那是反意圖、會鬼打牆），
  // 改走 RAG 用比較導向 prompt 客觀條列；主觀好壞交給真人（見生成段規則）。
  const isCompare = intentRes?.intent === 'compare'

  let embedTokenEstimate = estimateTokens(text)

  let chunks = await searchSimilarChunks(db, workspaceId, queryVector, DEFAULT_TOP_K_CHUNKS)
  let topSimilarity = chunks[0]?.similarity ?? 0

  // 追問補救：併上一輪客人訊息重新檢索一次，取「單句 vs 併上下文」分數較高者。
  // 兩種情況觸發：
  //   (a) 單句檢索不過 grounding 門檻（典型如「那運費呢？」缺主題詞，撈不到卡）；
  //   (b) 本次是「依賴上下文的追問」——只問屬性沒帶主題（「買多少錢」「有貨嗎」「怎麼用」
  //       「這個呢」）。即使單句剛好命中某張通用卡（分數過 grounding），主題也多半是錯的，
  //       不併上一輪就會用錯主題去檢索 / 反問（例：談 LG 清淨機後問「多少錢」撈到除濕機價格卡）。
  // 取 max 保護「真的換主題」的短句：併入反而拉低時，仍保留單句結果。
  // 觸發條件：屬性追問關鍵詞、或「短句」(規格型追問如「可以無線充電嗎」關鍵詞列不完，
  // 用長度兜底)、或單句沒過 grounding。一律取 max，所以對「自帶主題的短句」不會誤併拉歪。
  // isFollowup 優先用 intent router 的判斷；router 失敗才退回關鍵字/長度 heuristic
  const contextualQuery = buildContextualQuery(input.history, text)
  const looksLikeFollowup = intentRes
    ? intentRes.isFollowup
    : (isContextDependentFollowup(text) || text.length <= FOLLOWUP_MAX_LEN)
  if (contextualQuery && (looksLikeFollowup || topSimilarity < getGroundingThreshold(settings))) {
    try {
      const ctxVector = await embedQuery(contextualQuery)
      embedTokenEstimate += estimateTokens(contextualQuery)
      const ctxChunks = await searchSimilarChunks(db, workspaceId, ctxVector, DEFAULT_TOP_K_CHUNKS)
      if ((ctxChunks[0]?.similarity ?? 0) > topSimilarity) {
        chunks = ctxChunks
        topSimilarity = ctxChunks[0]?.similarity ?? 0
      }
    }
    catch (err) {
      console.warn('[ai-answer] contextual retrieval failed, keep single-turn result:', err)
    }
  }

  // 識別碼精確比對（品號 / SKU / 型號）：embedding 對這類 token 幾乎沒訊號，
  // tags 精確命中直接視為高信心來源。純中文提問零成本跳過（query 沒英數 run 直接回空）。
  try {
    const tagHits = await searchChunksByIdentifierTag(db, workspaceId, text)
    if (tagHits.length) {
      const byId = new Map(chunks.map(c => [c.id, c] as const))
      for (const hit of tagHits) {
        const existing = byId.get(hit.id)
        if (existing) existing.similarity = Math.max(existing.similarity, hit.similarity)
        else chunks.push(hit)
      }
      chunks.sort((a, b) => b.similarity - a.similarity)
      chunks = chunks.slice(0, DEFAULT_TOP_K_CHUNKS)
      topSimilarity = chunks[0]?.similarity ?? 0
    }
  }
  catch (err) {
    console.warn('[ai-answer] identifier-tag search failed, keep vector result:', err)
  }

  // ── 4. disambiguation 偵測（先於 grounding）──────────────
  // 「多張卡同樣相關」是比 grounding 更強的訊號 — 即使 top-1 略低於 grounding 門檻，
  // 也應該主動反問澄清而不是默默 handoff。disambiguation 條件不過再走 grounding gate。
  // 型錄/列表來源豁免：其旗下是不同產品，不可當同主題併掉（否則產品列表反問只剩 1 個 + 雜卡）
  const catalogSourceIds = await getCatalogSourceIds(db, workspaceId)
  const dedupedChunks = dedupeNearIdentical(dedupeBySource(chunks, catalogSourceIds))
  if (!input.skipDisambiguation && !isCompare && shouldDisambiguate(dedupedChunks, settings)) {
    // 反問選項優先產品卡，把「說明/政策/出貨」等通用主題卡排後面
    // 先把「同產品變體卡」併掉（避免 3 個都是同一台），再產品優先排序
    const candidates = preferProductCards(dedupeByTitleContainment(dedupedChunks)).slice(0, settings.disambiguation.maxOptions)
    const dis = await generateDisambiguation(candidates, text, settings)
    if (dis) {
      if (!input.isFollowup) {
        await recordAiUsage(workspaceId, {
          invocations: 1,
          disambiguations: 1,
          embeddingTokens: embedTokenEstimate,
          inputTokens: dis.inputTokens + routerIn,
          outputTokens: dis.outputTokens + routerOut,
        }, db)
      }
      return {
        decision: 'disambiguate',
        answer: '',
        confidence: topSimilarity,
        sources: chunks.map(c => ({ chunkId: c.id, title: c.title, similarity: c.similarity })),
        handoffReason: null,
        disambiguation: dis.payload,
      }
    }
    // generateDisambiguation 失敗（JSON 壞掉、白名單過濾後 < 2 個）→ 退回正常 grounding/answer
  }

  // ── 5. grounding 檢查 ────────────────────────────────────
  if (!chunks.length || topSimilarity < getGroundingThreshold(settings)) {
    if (!input.isFollowup) {
      await recordAiUsage(workspaceId, {
        invocations: 1,
        handoffs: 1,
        embeddingTokens: embedTokenEstimate,
        inputTokens: routerIn,
        outputTokens: routerOut,
      }, db)
    }
    return handoff('no_grounding', chunks)
  }

  // ── 6. 生成回答 ──────────────────────────────────────────
  // Context 瘦身：同來源去重、低於地板分（grounding 門檻 − 0.05）的卡不進 prompt、
  // 單卡內容截 CONTEXT_CARD_MAX_CHARS。top-1 已過 grounding 門檻，必在地板之上。
  const contextFloor = Math.max(0, getGroundingThreshold(settings) - 0.05)
  const contextChunks = dedupedChunks.filter(c => c.similarity >= contextFloor)
  const contextBlock = contextChunks
    .map((c, i) => `[卡 ${i + 1}｜${c.title}]\n${c.content.slice(0, CONTEXT_CARD_MAX_CHARS)}`)
    .join('\n\n')

  // 最近對話脈絡（最多 6 則）：讓 LLM 理解「那個」「還有呢」等指代，避免答非所問
  const historyTurns = (input.history ?? []).slice(-6)
  const historyBlock = historyTurns
    .map(t => `${t.role === 'user' ? '客人' : '客服'}：${t.text.trim().slice(0, 200)}`)
    .join('\n')

  const userPrompt = [
    ...(historyBlock
      ? ['【最近對話（最新在下，供理解指代與上下文）】', historyBlock, '']
      : []),
    '【可參考的知識卡】',
    contextBlock,
    '',
    '【客人提問】',
    text,
    '',
    '回傳 JSON：{ "answer": string, "hasInfo": boolean }',
    '請依「知識卡內容」回答，回覆文字放在 answer。',
    `answer 字數**硬性限制 ${settings.replyMaxLen} 字以內**，超過會被截斷，務必在限制內把話收完整、句子要結束（最後一個字必須是。！？或結尾語助詞）。`,
    '若知識卡沒有足夠資訊回答這個問題，hasInfo 設為 false、answer 留空字串；不要編造。',
    // 比較意圖：客觀條列差異即可，不要替客人做主觀的好壞 / 推薦判斷。
    ...(isCompare
      ? [
          '客人想比較多個產品。請依知識卡用簡短的方式條列各產品的客觀差異（類型 / 主要規格 / 特色）。',
          '只比較「知識卡裡有、且與客人問題同類」的產品；**若知識卡並未包含客人想比的那些產品，不要拿不相關的產品硬湊**，直接 hasInfo 設為 false（轉真人）。',
          '**不要**說「哪個比較好 / 比較划算 / 推薦哪個」這類主觀判斷；若客人問的正是主觀好壞，請在客觀差異後補一句「想知道哪個更適合您，我幫您轉接專員」。',
          '若知識卡資訊不足以做有意義的比較，hasInfo 設為 false、answer 留空（轉真人）。',
        ]
      : []),
    // 價格 / 購買類問題的連結處理：優先用卡片內的連結，否則用 workspace 設定的官網網址當 fallback。
    '若客人是在問價格、購買、哪裡買、下單：',
    '  - 知識卡內若有「連結：<網址>」，請把該連結附在回覆中，並說明最新價格 / 購買以該頁為準。',
    ...(settings.shopUrl
      ? [`  - 知識卡內若沒有連結，請回覆：最新價格與購買請見 ${settings.shopUrl}（此時 hasInfo 設為 true）。`]
      : []),
  ].join('\n')

  let answerText = ''
  let hasInfo = true
  let inputTokens = 0
  let outputTokens = 0
  try {
    // 結構化輸出：hasInfo 由 LLM 明確回報，取代舊版對「沒有這個資訊」的字串比對
    // （LLM 換個說法就漏網、把道歉文當正式回答發給客人）。
    const res = await generateJson<{ answer?: unknown; hasInfo?: unknown }>(userPrompt, {
      systemInstruction: settings.systemPrompt,
      temperature: 0.4,
      // 中文約 1.5–2 token/字；用 × 2.5 給 LLM 一點緩衝但避免它一路寫到超出限制太多，
      // 另加 128 token 給 JSON 結構與跳脫字元。truncateAtSentence 會把超出的部分整句砍掉。
      maxOutputTokens: Math.min(2048, Math.ceil(settings.replyMaxLen * 2.5) + 128),
      model: answerModel,
      // 關鍵：2.5 系列 thinking token 計入 maxOutputTokens；不關的話 thinking 吃掉配額
      // 會把 JSON 截斷 → parse 失敗 → 整題變 llm_error 假警報（客服收到誤報推播）
      thinkingBudget: 0,
    })
    answerText = String(res.data?.answer ?? '').trim()
    hasInfo = res.data?.hasInfo !== false
    // 併入 intent router 的 token（與 embedding 並行的那次 flash-lite 分類）
    inputTokens = res.inputTokens + routerIn
    outputTokens = res.outputTokens + routerOut
  }
  catch (err) {
    console.error('[ai-answer] generateText failed:', err)
    if (!input.isFollowup) {
      await recordAiUsage(workspaceId, {
        invocations: 1,
        handoffs: 1,
        embeddingTokens: embedTokenEstimate,
        inputTokens: routerIn,
        outputTokens: routerOut,
      }, db)
    }
    return handoff('llm_error', chunks)
  }

  // ── 6. 信心檢查 ──────────────────────────────────────────
  // v1：使用 top-1 retrieval similarity 作為信心分數。
  // 未來可加 LLM self-eval 做加權平均（簡報 p29 spike 點）。
  const confidence = topSimilarity
  const passesConfidence = confidence >= settings.confidenceThreshold
  const passesContent = hasInfo && answerText.length > 0

  const sourcesPayload = chunks.map(c => ({
    chunkId: c.id,
    title: c.title,
    similarity: c.similarity,
  }))

  if (!passesConfidence || !passesContent) {
    await recordAiUsage(workspaceId, input.isFollowup
      ? { embeddingTokens: embedTokenEstimate, inputTokens, outputTokens }
      : {
          invocations: 1,
          handoffs: 1,
          embeddingTokens: embedTokenEstimate,
          inputTokens,
          outputTokens,
        }, db)
    return {
      decision: 'handoff',
      answer: '',
      confidence,
      sources: sourcesPayload,
      handoffReason: passesContent ? 'low_confidence' : 'no_grounding',
      ...(input.debug ? { debugPrompt: userPrompt } : {}),
    }
  }

  await recordAiUsage(workspaceId, input.isFollowup
    ? { embeddingTokens: embedTokenEstimate, inputTokens, outputTokens }
    : {
        invocations: 1,
        answered: 1,
        embeddingTokens: embedTokenEstimate,
        inputTokens,
        outputTokens,
      }, db)

  return {
    decision: 'answered',
    answer: truncateAtSentence(answerText, settings.replyMaxLen),
    confidence,
    sources: sourcesPayload,
    handoffReason: null,
    ...(input.debug ? { debugPrompt: userPrompt } : {}),
  }
}
