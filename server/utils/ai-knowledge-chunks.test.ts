import { describe, expect, it, vi } from 'vitest'
import { buildEmbeddingText, extractIdentifierRuns } from './ai-knowledge-chunks'
import { chunkTextWithLlm, segmentText } from './ai-knowledge-chunker'

// 切卡的 LLM 呼叫改成「看 prompt 內容決定輸出」——純函式、與並行排程無關，
// 這樣就能穩定驗證「照段序合併 + 去重」而不會因為哪一段先回來而 flaky。
vi.mock('./gemini', () => ({
  generateJson: vi.fn(async (prompt: string) => {
    // 每段開頭埋 @@M0@@、@@M1@@…；mock 為該段每個標記各回一張卡，
    // 再固定附一張同名 'DUP' 卡（用來驗證跨段去重只留第一張）。
    const marks = [...prompt.matchAll(/@@(M\d+)@@/g)].map(m => m[1])
    const chunks = [
      { title: 'DUP', content: '共用卡', tags: [], questions: [] },
      ...marks.map(t => ({ title: t, content: `內容 ${t}`, tags: [], questions: [] })),
    ]
    return { data: { chunks }, inputTokens: 1, outputTokens: 1 }
  }),
}))

describe('buildEmbeddingText', () => {
  it('title + content 換行串接', () => {
    expect(buildEmbeddingText('運費說明', '滿千免運。')).toBe('運費說明\n滿千免運。')
  })

  it('questions 夾在 title 與 content 之間', () => {
    expect(buildEmbeddingText('運費說明', '滿千免運。', ['運費怎麼算？', '多少免運？']))
      .toBe('運費說明\n運費怎麼算？\n多少免運？\n滿千免運。')
  })

  it('空 title / 空 questions 不留空行', () => {
    expect(buildEmbeddingText('', '內容', [])).toBe('內容')
    expect(buildEmbeddingText('標題', '內容', ['', '  '])).toBe('標題\n內容')
  })
})

describe('extractIdentifierRuns', () => {
  it('抽出 ≥4 碼且含數字的英數 run 並小寫', () => {
    expect(extractIdentifierRuns('品號 21070909 還有貨嗎')).toEqual(['21070909'])
    expect(extractIdentifierRuns('型號 AB-1234C 的規格')).toEqual(['1234c'])
  })

  it('純中文 / 短英數不觸發', () => {
    expect(extractIdentifierRuns('運費怎麼算？')).toEqual([])
    expect(extractIdentifierRuns('A12 跟 b3')).toEqual([])
  })

  it('不含數字的一般英文單字不觸發（LINE、mail、ipad）', () => {
    expect(extractIdentifierRuns('可以用LINE訂購嗎')).toEqual([])
    expect(extractIdentifierRuns('ipad mail shop 2024')).toEqual(['2024'])
  })
})

describe('segmentText', () => {
  it('短文不分段', () => {
    expect(segmentText('hello', 100)).toEqual(['hello'])
  })

  it('長文按換行邊界切、每段不超過上限', () => {
    const para = 'x'.repeat(80)
    const text = Array.from({ length: 10 }, () => para).join('\n')
    const segments = segmentText(text, 200)
    expect(segments.length).toBeGreaterThan(1)
    for (const s of segments) {
      expect(s.length).toBeLessThanOrEqual(200)
    }
    // 內容不遺失（忽略換行後合併等於原文）
    expect(segments.join('').replace(/\n/g, '')).toBe(text.replace(/\n/g, ''))
  })

  it('整段沒換行就硬切', () => {
    const text = 'y'.repeat(450)
    const segments = segmentText(text, 200)
    expect(segments).toEqual(['y'.repeat(200), 'y'.repeat(200), 'y'.repeat(50)])
  })
})

describe('chunkTextWithLlm（分段並行 + 合併去重）', () => {
  // 8 行、每行一個標記 + 6000 字填充 → segmentText(預設 20k)會切成多段，
  // 標記 M0..M7 分散在各段但保持順序、每個各出現一次。
  const lines = Array.from({ length: 8 }, (_, i) => `@@M${i}@@ ${'a'.repeat(6000)}`)
  const text = lines.join('\n')

  it('多段時每段各呼叫一次 LLM，token 照段數累加', async () => {
    const { generateJson } = await import('./gemini') as unknown as { generateJson: ReturnType<typeof vi.fn> }
    generateJson.mockClear()
    const segCount = segmentText(text).length
    expect(segCount).toBeGreaterThan(1)

    const res = await chunkTextWithLlm(text)
    expect(generateJson).toHaveBeenCalledTimes(segCount)
    expect(res.inputTokens).toBe(segCount)
    expect(res.outputTokens).toBe(segCount)
  })

  it('輸出照「段序」合併，且同名卡跨段只留第一張', async () => {
    const res = await chunkTextWithLlm(text)
    // 每段都回一張 'DUP'，去重後只剩第一段那張，位置在最前；其餘為 M0..M7 依序。
    expect(res.chunks.map(c => c.title)).toEqual([
      'DUP', 'M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7',
    ])
  })

  it('空字串直接回空結果、不呼叫 LLM', async () => {
    const { generateJson } = await import('./gemini') as unknown as { generateJson: ReturnType<typeof vi.fn> }
    generateJson.mockClear()
    const res = await chunkTextWithLlm('   ')
    expect(res.chunks).toEqual([])
    expect(generateJson).not.toHaveBeenCalled()
  })
})
