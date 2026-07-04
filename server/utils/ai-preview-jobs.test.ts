import { beforeEach, describe, expect, it, vi } from 'vitest'

// LLM 切卡 / 總覽卡改成可控 mock（保留真的 segmentText / MAX_TOTAL_CHUNKS）
vi.mock('./ai-knowledge-chunker', async (importActual) => {
  const actual = await importActual<typeof import('./ai-knowledge-chunker')>()
  return { ...actual, chunkSegment: vi.fn(), summarizeAsOverviewCard: vi.fn() }
})
// 切頁與 OCR 改 mock，不碰真的 pdf-lib / Gemini
vi.mock('./pdf-split', () => ({
  splitPdfPageRange: vi.fn(async () => Buffer.from('sub-pdf')),
  getPdfPageCount: vi.fn(async () => 0),
}))
vi.mock('./ai-source-extractors', async (importActual) => {
  const actual = await importActual<typeof import('./ai-source-extractors')>()
  return { ...actual, ocrPdfWithGemini: vi.fn() }
})

import { advanceWork, makeWork, progressFor, workToPreviewResult } from './ai-preview-jobs'
import { chunkSegment, summarizeAsOverviewCard } from './ai-knowledge-chunker'
import { ocrPdfWithGemini } from './ai-source-extractors'

const mockChunk = vi.mocked(chunkSegment)
const mockOverview = vi.mocked(summarizeAsOverviewCard)
const mockOcr = vi.mocked(ocrPdfWithGemini)

const card = (title: string) => ({ title, content: 'c', tags: [], questions: [], sourceId: null })

beforeEach(() => {
  mockChunk.mockReset()
  mockOverview.mockReset()
  mockOcr.mockReset()
})

describe('advanceWork — chunk 階段', () => {
  it('逐段推進、累積 + 同 title 跨段去重，做完轉 finalize（無總覽卡）', async () => {
    mockChunk.mockImplementation(async (text: string) => ({
      chunks: [card(`T-${text}`), card('DUP')],
      inputTokens: 1,
      outputTokens: 2,
    }))
    const work = makeWork({ type: 'text', generateOverview: false })
    work.sourceName = 'doc'
    work.segments = ['seg1', 'seg2']
    work.phase = 'chunk'

    await advanceWork(work)
    expect(work.phase).toBe('chunk')
    expect(work.segmentCursor).toBe(1)

    await advanceWork(work)
    expect(work.phase).toBe('finalize')
    expect(work.segmentCursor).toBe(2)
    expect(work.chunks.map(c => c.title)).toEqual(['T-seg1', 'DUP', 'T-seg2'])
    expect(work.usage).toEqual({ inputTokens: 2, outputTokens: 4 })
    expect(mockChunk).toHaveBeenCalledTimes(2)
  })

  it('切卡撞輸出上限（截斷）→ 對半切原地換入、不進 cursor，下一輪用更小段重試', async () => {
    const truncErr = Object.assign(
      new Error('Gemini JSON parse failed: Unterminated string in JSON'),
      { statusMessage: 'Gemini JSON parse failed: Unterminated string in JSON' },
    )
    // 大段（>4000）截斷；切小後（≤4000）成功。用 call 計數給不同 title 避免去重誤消。
    let call = 0
    mockChunk.mockImplementation(async (text: string) => {
      if (text.length > 4000) throw truncErr
      call += 1
      return { chunks: [card(`T${call}`)], inputTokens: 1, outputTokens: 1 }
    })
    const work = makeWork({ type: 'text', generateOverview: false })
    work.sourceName = 'doc'
    work.segments = ['x\n'.repeat(3000)] // ~6000 字，可切、> MIN_SEGMENT_SPLIT_LEN
    work.phase = 'chunk'

    await advanceWork(work) // 截斷 → 切成 2 段
    expect(work.segmentCursor).toBe(0)
    expect(work.phase).toBe('chunk')
    expect(work.segments.length).toBe(2)

    await advanceWork(work) // 小段成功 → cursor 1
    await advanceWork(work) // 小段成功 → cursor 2 → finalize
    expect(work.phase).toBe('finalize')
    expect(work.chunks.length).toBe(2)
  })

  it('非截斷錯誤（如網路 502）不切，直接往外丟', async () => {
    mockChunk.mockRejectedValue(Object.assign(new Error('Gemini error: network error'), {
      statusMessage: 'Gemini error: network error',
    }))
    const work = makeWork({ type: 'text', generateOverview: false })
    work.sourceName = 'doc'
    work.segments = ['a\n'.repeat(3000)]
    work.phase = 'chunk'
    await expect(advanceWork(work)).rejects.toThrow(/network error/)
    expect(work.segments.length).toBe(1) // 沒被切
  })

  it('generateOverview 且卡≥2 → 切完轉 overview，再轉 finalize 並帶總覽卡', async () => {
    mockChunk.mockResolvedValue({ chunks: [card('A'), card('B')], inputTokens: 1, outputTokens: 1 })
    mockOverview.mockResolvedValue({
      card: { title: '總覽', content: 'c', tags: ['x'], questions: ['q'], sourceId: null, isOverview: true },
      inputTokens: 3,
      outputTokens: 4,
    })
    const work = makeWork({ type: 'text', generateOverview: true })
    work.sourceName = 'doc'
    work.segments = ['only']
    work.phase = 'chunk'

    await advanceWork(work)
    expect(work.phase).toBe('overview')

    await advanceWork(work)
    expect(work.phase).toBe('finalize')
    expect(work.overviewCard?.title).toBe('總覽')
    expect(work.usage).toEqual({ inputTokens: 4, outputTokens: 5 })
  })

  it('總覽卡合成失敗不擋，仍轉 finalize、overviewCard 保持 null', async () => {
    mockOverview.mockRejectedValue(new Error('boom'))
    const work = makeWork({ type: 'text', generateOverview: true })
    work.chunks = [card('A'), card('B')]
    work.phase = 'overview'

    await advanceWork(work)
    expect(work.phase).toBe('finalize')
    expect(work.overviewCard).toBeNull()
  })
})

describe('advanceWork — ocr 階段（切頁批處理）', () => {
  it('每輪 OCR 一批頁、累積文字，做完轉 chunk 並標 ocrUsed', async () => {
    let n = 0
    mockOcr.mockImplementation(async () => {
      n += 1
      return { text: `page${n}`, rawLength: 5, meta: {}, inputTokens: 1, outputTokens: 1 }
    })
    const work = makeWork({ type: 'file', generateOverview: false })
    work.sourceName = 'scan.pdf'
    work.phase = 'ocr'
    work.ocrPageTotal = 12
    const deps = { getSourceBuffer: async () => Buffer.from('pdf') }

    await advanceWork(work, deps)
    expect(work.ocrPageCursor).toBe(5)
    expect(work.phase).toBe('ocr')

    await advanceWork(work, deps)
    expect(work.ocrPageCursor).toBe(10)
    expect(work.phase).toBe('ocr')

    await advanceWork(work, deps)
    expect(work.ocrPageCursor).toBe(12)
    expect(work.phase).toBe('chunk')
    expect(work.ocrUsed).toBe(true)
    expect(work.ocrText).toBe('page1\npage2\npage3')
    expect(work.segments.length).toBeGreaterThan(0)
    expect(work.usage).toEqual({ inputTokens: 3, outputTokens: 3 })
    expect(mockOcr).toHaveBeenCalledTimes(3)
  })
})

describe('progressFor / workToPreviewResult', () => {
  it('progressFor 依 phase 回進度', () => {
    const work = makeWork({ type: 'text', generateOverview: false })
    work.phase = 'chunk'
    work.segments = ['a', 'b', 'c']
    work.segmentCursor = 1
    expect(progressFor(work)).toEqual({ done: 1, total: 3, label: '切卡' })

    work.phase = 'ocr'
    work.ocrPageCursor = 5
    work.ocrPageTotal = 12
    expect(progressFor(work)).toEqual({ done: 5, total: 12, label: '辨識掃描檔' })
  })

  it('workToPreviewResult 形狀與舊 preview-chunks 一致', () => {
    const work = makeWork({ type: 'url', generateOverview: false })
    work.sourceName = 'x'
    work.sourceUrl = 'https://x'
    work.chunks = [card('A')]
    const res = workToPreviewResult(work)
    expect(res.sourceName).toBe('x')
    expect(res.sourceUrl).toBe('https://x')
    expect(res.chunks).toEqual([{ title: 'A', content: 'c', tags: [], questions: [] }])
    expect(res.overviewCard).toBeNull()
    expect(res.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
  })
})
