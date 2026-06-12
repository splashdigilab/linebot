import { describe, expect, it } from 'vitest'
import { buildEmbeddingText, extractIdentifierRuns } from './ai-knowledge-chunks'
import { segmentText } from './ai-knowledge-chunker'

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
