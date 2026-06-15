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
 * 把「上一輪客人訊息」併進本次提問，給追問補救檢索用。
 * 沒有可用的上一輪（無 history、上一輪與本次相同）回 null。
 */
export function buildContextualQuery(
  history: AiChatTurn[] | undefined,
  current: string,
): string | null {
  if (!history?.length) return null
  const cur = current.trim()
  const prevUser = [...history].reverse().find(
    t => t.role === 'user' && t.text.trim() && t.text.trim() !== cur,
  )
  if (!prevUser) return null
  return `${prevUser.text.trim()}\n${cur}`.slice(0, 1000)
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
 * 同 sourceId 只留分數最高那張；無 sourceId 的卡視為各自獨立。
 * 結果保持原本由高到低的順序。
 */
export function dedupeBySource(chunks: SimilarChunk[]): SimilarChunk[] {
  const seen = new Set<string>()
  const out: SimilarChunk[] = []
  for (const c of chunks) {
    const key = c.sourceId
    if (!key) {
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
  // 注意：「先讀用量再答題、答完才記帳」並非嚴格原子——併發訊息可能讓當月用量
  // 略為超過 cap（誤差約為同時在途的幾次呼叫）。cap 是軟性護欄，可接受此誤差；
  // 若未來要做硬性計費上限，需改用 transaction 預扣。
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

  // ── 3. 向量搜尋 ──────────────────────────────────────────
  let queryVector: number[]
  try {
    queryVector = await embedQuery(text)
  }
  catch (err) {
    console.error('[ai-answer] embedQuery failed:', err)
    if (!input.isFollowup) {
      await recordAiUsage(workspaceId, { invocations: 1, handoffs: 1 }, db)
    }
    return handoff('llm_error')
  }
  let embedTokenEstimate = estimateTokens(text)

  let chunks = await searchSimilarChunks(db, workspaceId, queryVector, DEFAULT_TOP_K_CHUNKS)
  let topSimilarity = chunks[0]?.similarity ?? 0

  // 追問補救：單句檢索不過 grounding 門檻時（典型如「那運費呢？」缺主題詞），
  // 併上一輪客人訊息重新檢索一次，取分數較高的結果。只在低分時多花一次 embed。
  const contextualQuery = buildContextualQuery(input.history, text)
  if (contextualQuery && topSimilarity < getGroundingThreshold(settings)) {
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
  const dedupedChunks = dedupeNearIdentical(dedupeBySource(chunks))
  if (!input.skipDisambiguation && shouldDisambiguate(dedupedChunks, settings)) {
    const candidates = dedupedChunks.slice(0, settings.disambiguation.maxOptions)
    const dis = await generateDisambiguation(candidates, text, settings)
    if (dis) {
      if (!input.isFollowup) {
        await recordAiUsage(workspaceId, {
          invocations: 1,
          disambiguations: 1,
          embeddingTokens: embedTokenEstimate,
          inputTokens: dis.inputTokens,
          outputTokens: dis.outputTokens,
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
    inputTokens = res.inputTokens
    outputTokens = res.outputTokens
  }
  catch (err) {
    console.error('[ai-answer] generateText failed:', err)
    if (!input.isFollowup) {
      await recordAiUsage(workspaceId, {
        invocations: 1,
        handoffs: 1,
        embeddingTokens: embedTokenEstimate,
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
