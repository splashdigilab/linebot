import { beforeEach, describe, expect, it, vi } from 'vitest'

// gemini 只需 generateJson（供 importActual 的真 chunker 匯入乾淨），實際不會被呼叫
vi.mock('./gemini', () => ({ generateJson: vi.fn(), generateParts: vi.fn() }))
// 保留真的 needsQuestionEnrichment（純函數），只把 LLM 呼叫換成 mock
vi.mock('./ai-knowledge-chunker', async (importActual) => {
  const actual = await importActual<typeof import('./ai-knowledge-chunker')>()
  return { ...actual, enrichCardsWithLlm: vi.fn() }
})
vi.mock('./ai-knowledge-chunks', () => ({
  KNOWLEDGE_CHUNKS_COLLECTION: 'knowledge_chunks',
  updateKnowledgeChunk: vi.fn(),
}))
vi.mock('./ai-usage', () => ({ recordAiUsage: vi.fn() }))

import { REENRICH_SCAN_LIMIT, reenrichWorkspaceChunks } from './ai-reenrich'
import { enrichCardsWithLlm } from './ai-knowledge-chunker'
import { updateKnowledgeChunk } from './ai-knowledge-chunks'
import { recordAiUsage } from './ai-usage'

const mockEnrich = vi.mocked(enrichCardsWithLlm)
const mockUpdate = vi.mocked(updateKnowledgeChunk)
const mockUsage = vi.mocked(recordAiUsage)

// 假 Firestore：支援 collection().where().orderBy().select().limit().startAfter().get() 與 .doc()
function makeDb(rows: Array<{ id: string; data: Record<string, unknown> }>) {
  function makeQuery() {
    const state = { limit: rows.length, after: null as string | null }
    const q: any = {
      where: () => q,
      orderBy: () => q,
      select: () => q,
      limit: (n: number) => { state.limit = n; return q },
      startAfter: (d: { id: string }) => { state.after = d?.id ?? null; return q },
      doc: (id: string) => ({ id }),
      get: async () => {
        let arr = rows
        if (state.after) arr = rows.slice(rows.findIndex(r => r.id === state.after) + 1)
        arr = arr.slice(0, state.limit)
        return { size: arr.length, docs: arr.map(r => ({ id: r.id, data: () => r.data })) }
      },
    }
    return q
  }
  return { collection: () => makeQuery() } as any
}

const chunk = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  data: { title: `T-${id}`, content: `C-${id}`, tags: [], questions: [], isOverview: false, manuallyEditedAt: null, ...over },
})

beforeEach(() => {
  mockEnrich.mockReset()
  mockUpdate.mockReset()
  mockUsage.mockReset()
  mockUsage.mockResolvedValue(undefined as any)
  mockUpdate.mockResolvedValue({ status: 'indexed' } as any)
})

describe('reenrichWorkspaceChunks', () => {
  it('只挑「沒問法、非人工、非總覽」的卡補；只補 questions 不動 title/content；記帳一次', async () => {
    mockEnrich.mockImplementation(async cards => ({
      items: cards.map((_, i) => ({ questions: [`q-${i}`], tags: [] })),
      inputTokens: 4,
      outputTokens: 6,
    }))
    const db = makeDb([
      chunk('a'), // 要補
      chunk('b', { questions: ['已有'] }), // 已有問法 → 跳過
      chunk('c', { manuallyEditedAt: { seconds: 1 } }), // 人工編輯過 → 跳過
      chunk('d', { isOverview: true }), // 總覽卡 → 跳過
      chunk('e'), // 要補
    ])
    const res = await reenrichWorkspaceChunks(db, 'ws1', '')

    expect(res.batch).toBe(5)
    expect(res.candidates).toBe(2)
    expect(res.enriched).toBe(2)
    expect(res.usage).toEqual({ inputTokens: 4, outputTokens: 6 })

    expect(mockUpdate).toHaveBeenCalledTimes(2)
    expect(mockUpdate.mock.calls.map(c => c[1].chunkId).sort()).toEqual(['a', 'e'])
    for (const [, params] of mockUpdate.mock.calls) {
      expect(params.contentChanged).toBe(false) // 只補問法，內容沒變
      expect(params.questions?.length).toBeGreaterThan(0)
    }
    expect(mockUsage).toHaveBeenCalledTimes(1)
  })

  it('LLM 對某卡沒回問法 → 那張不 update、enriched 不計（留給下次重跑）', async () => {
    mockEnrich.mockResolvedValue({
      items: [{ questions: ['ok'], tags: [] }, { questions: [], tags: [] }],
      inputTokens: 1,
      outputTokens: 1,
    })
    const res = await reenrichWorkspaceChunks(makeDb([chunk('a'), chunk('b')]), 'ws1', '')
    expect(res.candidates).toBe(2)
    expect(res.enriched).toBe(1)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate.mock.calls[0]![1].chunkId).toBe('a')
  })

  it('原本沒標籤才補 tags；有標籤則不動（傳 undefined 保留）', async () => {
    mockEnrich.mockResolvedValue({
      items: [{ questions: ['q'], tags: ['新標籤'] }, { questions: ['q'], tags: ['忽略'] }],
      inputTokens: 1,
      outputTokens: 1,
    })
    const db = makeDb([chunk('a'), chunk('b', { tags: ['既有'] })])
    await reenrichWorkspaceChunks(db, 'ws1', '')
    const byId = Object.fromEntries(mockUpdate.mock.calls.map(c => [c[1].chunkId, c[1]]))
    expect(byId.a!.tags).toEqual(['新標籤']) // 原本沒標籤 → 補
    expect(byId.b!.tags).toBeUndefined() // 原本有標籤 → 保留（傳 undefined）
  })

  it('沒有候選卡 → 不呼叫 LLM、不記帳、nextCursor 為 null', async () => {
    const res = await reenrichWorkspaceChunks(makeDb([chunk('a', { questions: ['有'] })]), 'ws1', '')
    expect(res.candidates).toBe(0)
    expect(res.enriched).toBe(0)
    expect(mockEnrich).not.toHaveBeenCalled()
    expect(mockUsage).not.toHaveBeenCalled()
    expect(res.nextCursor).toBeNull()
  })

  it('滿頁（= SCAN_LIMIT）→ nextCursor = 最後一張 id；不滿頁 → null', async () => {
    mockEnrich.mockImplementation(async cards => ({
      items: cards.map(() => ({ questions: ['q'], tags: [] })),
      inputTokens: 1,
      outputTokens: 1,
    }))
    const full = Array.from({ length: REENRICH_SCAN_LIMIT }, (_, i) => chunk(`k${String(i).padStart(3, '0')}`))
    const res = await reenrichWorkspaceChunks(makeDb(full), 'ws1', '')
    expect(res.batch).toBe(REENRICH_SCAN_LIMIT)
    expect(res.nextCursor).toBe(`k${String(REENRICH_SCAN_LIMIT - 1).padStart(3, '0')}`)

    const res2 = await reenrichWorkspaceChunks(makeDb(full.slice(0, 3)), 'ws1', '')
    expect(res2.nextCursor).toBeNull()
  })

  it('帶 cursor → 從該 id 之後開始掃', async () => {
    mockEnrich.mockImplementation(async cards => ({
      items: cards.map(() => ({ questions: ['q'], tags: [] })),
      inputTokens: 1,
      outputTokens: 1,
    }))
    const res = await reenrichWorkspaceChunks(makeDb([chunk('a'), chunk('b'), chunk('c')]), 'ws1', 'a')
    expect(res.batch).toBe(2) // 只掃到 b、c
    expect(mockUpdate.mock.calls.map(c => c[1].chunkId).sort()).toEqual(['b', 'c'])
  })
})
