import { describe, it, expect } from 'vitest'
import {
  truncateAtSentence,
  dedupeBySource,
  shouldDisambiguate,
  matchCandidateTitle,
  buildContextualQuery,
} from './ai-answer'
import type { SimilarChunk } from './ai-knowledge-chunks'
import { detectSensitiveTopic } from '~~/shared/types/ai-knowledge'

function chunk(partial: Partial<SimilarChunk> & { id: string }): SimilarChunk {
  return {
    title: partial.id,
    content: '',
    tags: [],
    similarity: 0,
    sourceId: null,
    ...partial,
  }
}

describe('truncateAtSentence', () => {
  it('未超長時原樣回傳', () => {
    expect(truncateAtSentence('好的。', 50)).toBe('好的。')
  })

  it('超長時切在 maxLen 內最後一個句末符號', () => {
    const text = '第一句。第二句。第三句還沒結束'
    const out = truncateAtSentence(text, 10)
    expect(out).toBe('第一句。第二句。')
    expect(out.length).toBeLessThanOrEqual(10)
  })

  it('支援 ！？與換行作為句末', () => {
    expect(truncateAtSentence('有貨嗎！我想要這個顏色的', 8)).toBe('有貨嗎！')
    expect(truncateAtSentence('第一行\n第二行超出限制了', 5)).toBe('第一行')
  })

  it('整段沒有句末符號時硬切並補 …', () => {
    const text = '一二三四五六七八九十'
    const out = truncateAtSentence(text, 5)
    expect(out).toBe('一二三四…')
    expect(out.length).toBeLessThanOrEqual(5)
  })

  it('永不輸出超過 maxLen 的內容', () => {
    const samples = ['句子一。句子二。句子三。', '完全沒有標點的長文字串拉拉拉拉拉', 'A。B！C？D\nE']
    for (const s of samples) {
      for (const maxLen of [3, 5, 8, 12]) {
        expect(truncateAtSentence(s, maxLen).length).toBeLessThanOrEqual(maxLen)
      }
    }
  })
})

describe('dedupeBySource', () => {
  it('同 sourceId 只留第一張（分數最高），保持順序', () => {
    const input = [
      chunk({ id: 'a', sourceId: 's1', similarity: 0.9 }),
      chunk({ id: 'b', sourceId: 's2', similarity: 0.8 }),
      chunk({ id: 'c', sourceId: 's1', similarity: 0.7 }),
    ]
    expect(dedupeBySource(input).map(c => c.id)).toEqual(['a', 'b'])
  })

  it('無 sourceId 的卡各自獨立、全部保留', () => {
    const input = [
      chunk({ id: 'a', sourceId: null }),
      chunk({ id: 'b', sourceId: null }),
    ]
    expect(dedupeBySource(input)).toHaveLength(2)
  })
})

describe('shouldDisambiguate', () => {
  const settings = {
    disambiguation: {
      enabled: true,
      top1Min: 0.5,
      top1Max: 0.75,
      maxSpread: 0.06,
      maxOptions: 3,
      cooldownMinutes: 10,
    },
  }
  const pair = (top1: number, top2: number) => [
    chunk({ id: 'a', similarity: top1 }),
    chunk({ id: 'b', similarity: top2 }),
  ]

  it('top-1 在擦邊區且與 top-2 差距小 → true', () => {
    expect(shouldDisambiguate(pair(0.6, 0.58), settings)).toBe(true)
  })

  it('disabled → false', () => {
    expect(shouldDisambiguate(pair(0.6, 0.58), {
      disambiguation: { ...settings.disambiguation, enabled: false },
    })).toBe(false)
  })

  it('不足兩張卡 → false', () => {
    expect(shouldDisambiguate([chunk({ id: 'a', similarity: 0.6 })], settings)).toBe(false)
    expect(shouldDisambiguate([], settings)).toBe(false)
  })

  it('top-1 低於 top1Min 或不低於 top1Max → false', () => {
    expect(shouldDisambiguate(pair(0.4, 0.39), settings)).toBe(false)
    expect(shouldDisambiguate(pair(0.75, 0.74), settings)).toBe(false)
    expect(shouldDisambiguate(pair(0.9, 0.88), settings)).toBe(false)
  })

  it('top-1 / top-2 差距達 maxSpread → false', () => {
    expect(shouldDisambiguate(pair(0.7, 0.6), settings)).toBe(false)
    expect(shouldDisambiguate(pair(0.7, 0.63), settings)).toBe(false)
  })
})

describe('matchCandidateTitle', () => {
  const candidates = [
    chunk({ id: '1', title: '巴拿馬 藝伎 水洗 (品號:21070909)' }),
    chunk({ id: '2', title: '衣索比亞 耶加雪菲' }),
    chunk({ id: '3', title: '運費與配送說明' }),
  ]

  it('完全相等優先', () => {
    expect(matchCandidateTitle('衣索比亞 耶加雪菲', candidates)?.id).toBe('2')
  })

  it('LLM 簡化標題（去掉品號）可用 prefix 對回原卡', () => {
    expect(matchCandidateTitle('巴拿馬 藝伎 水洗', candidates)?.id).toBe('1')
  })

  it('contains 為最後手段（雙向）', () => {
    expect(matchCandidateTitle('配送', candidates)?.id).toBe('3')
  })

  it('無法對應 → null；空字串 → null', () => {
    expect(matchCandidateTitle('完全無關的標題', candidates)).toBeNull()
    expect(matchCandidateTitle('  ', candidates)).toBeNull()
  })

  it('忽略空白與大小寫差異', () => {
    expect(matchCandidateTitle('衣索比亞耶加雪菲', candidates)?.id).toBe('2')
  })
})

describe('buildContextualQuery', () => {
  it('併上一輪客人訊息與本次提問', () => {
    const history = [
      { role: 'user' as const, text: '藝伎咖啡豆怎麼賣？' },
      { role: 'bot' as const, text: '半磅 800 元。' },
    ]
    expect(buildContextualQuery(history, '那運費呢？')).toBe('藝伎咖啡豆怎麼賣？\n那運費呢？')
  })

  it('取「最近的一輪」客人訊息', () => {
    const history = [
      { role: 'user' as const, text: '舊話題' },
      { role: 'bot' as const, text: '...' },
      { role: 'user' as const, text: '新話題' },
      { role: 'bot' as const, text: '...' },
    ]
    expect(buildContextualQuery(history, '多少錢？')).toBe('新話題\n多少錢？')
  })

  it('無 history 或上一輪與本次相同 → null', () => {
    expect(buildContextualQuery(undefined, '運費？')).toBeNull()
    expect(buildContextualQuery([], '運費？')).toBeNull()
    expect(buildContextualQuery([{ role: 'user', text: '運費？' }], '運費？')).toBeNull()
    expect(buildContextualQuery([{ role: 'bot', text: '您好' }], '運費？')).toBeNull()
  })
})

describe('detectSensitiveTopic', () => {
  const topics = ['退費', '法律', 'Refund']

  it('命中回傳原 topic（大小寫不敏感）', () => {
    expect(detectSensitiveTopic('我要退費！', topics)).toBe('退費')
    expect(detectSensitiveTopic('please REFUND me', topics)).toBe('Refund')
  })

  it('未命中 / 空輸入 → null', () => {
    expect(detectSensitiveTopic('請問營業時間', topics)).toBeNull()
    expect(detectSensitiveTopic('', topics)).toBeNull()
  })
})
