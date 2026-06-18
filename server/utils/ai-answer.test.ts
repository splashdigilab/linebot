import { describe, it, expect } from 'vitest'
import {
  truncateAtSentence,
  dedupeBySource,
  dedupeNearIdentical,
  shouldDisambiguate,
  matchCandidateTitle,
  buildContextualQuery,
  isReplyingToBotQuestion,
  isContextDependentFollowup,
  socialCannedReply,
  preferProductCards,
  dedupeByTitleContainment,
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
    isOverview: false,
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

  it('豁免來源（型錄）的同源卡全部保留（不同產品不可併）', () => {
    const input = [
      chunk({ id: 'a', sourceId: 'catalog', similarity: 0.9 }),
      chunk({ id: 'b', sourceId: 'catalog', similarity: 0.8 }),
      chunk({ id: 'c', sourceId: 's2', similarity: 0.7 }),
      chunk({ id: 'd', sourceId: 's2', similarity: 0.6 }),
    ]
    // catalog 豁免 → a、b 都留；s2 非豁免 → 只留 c
    expect(dedupeBySource(input, new Set(['catalog'])).map(x => x.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('dedupeNearIdentical', () => {
  it('跨來源同標題（忽略空白大小寫）只留排前面那張', () => {
    const input = [
      chunk({ id: 'a', title: '退換貨政策', content: '七天鑑賞期。', sourceId: 's1', similarity: 0.8 }),
      chunk({ id: 'b', title: '退換貨 政策', content: '7 天鑑賞期內可退。', sourceId: 's2', similarity: 0.79 }),
    ]
    expect(dedupeNearIdentical(input).map(c => c.id)).toEqual(['a'])
  })

  it('同內容不同標題也視為重複', () => {
    const input = [
      chunk({ id: 'a', title: '運費', content: '滿千免運。', sourceId: 's1' }),
      chunk({ id: 'b', title: '運費說明', content: '滿千免運。', sourceId: 's2' }),
    ]
    expect(dedupeNearIdentical(input).map(c => c.id)).toEqual(['a'])
  })

  it('標題與內容都不同的卡全部保留', () => {
    const input = [
      chunk({ id: 'a', title: '運費', content: '滿千免運。' }),
      chunk({ id: 'b', title: '退換貨', content: '七天鑑賞期。' }),
    ]
    expect(dedupeNearIdentical(input)).toHaveLength(2)
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

  it('top-1 是總覽卡 → false（列舉型問題直接用總覽卡答，不反問）', () => {
    const withOverview = [
      chunk({ id: 'a', similarity: 0.6, isOverview: true }),
      chunk({ id: 'b', similarity: 0.58 }),
    ]
    expect(shouldDisambiguate(withOverview, settings)).toBe(false)
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

  it('多輪斷鏈修正：往回找自帶主題的錨點，串起整條（D-2）', () => {
    const history = [
      { role: 'user' as const, text: '奇美的燈' },
      { role: 'bot' as const, text: '...' },
      { role: 'user' as const, text: '保固多久' }, // 追問句（含「保固/多久」）
      { role: 'bot' as const, text: '...' },
    ]
    // 「怎麼申請」往回跳過「保固多久」、錨到「奇美的燈」，整條串起來
    expect(buildContextualQuery(history, '怎麼申請')).toBe('奇美的燈\n保固多久\n怎麼申請')
  })
})

describe('isReplyingToBotQuestion', () => {
  it('bot 反問澄清後，客人回一個短主題詞 → 視為回答反問', () => {
    const history = [
      { role: 'user' as const, text: '買很久了為什麼都還沒到貨' },
      { role: 'bot' as const, text: '請問您想了解的是哪項商品的到貨時間呢？' },
    ]
    expect(isReplyingToBotQuestion(history, '枕頭')).toBe(true)
  })

  it('上一則不是 bot、或 bot 不是在發問 → false', () => {
    expect(isReplyingToBotQuestion([{ role: 'user' as const, text: '哪個好呢？' }], '枕頭')).toBe(false)
    expect(isReplyingToBotQuestion([{ role: 'bot' as const, text: '好的，已為您處理。' }], '枕頭')).toBe(false)
  })

  it('客人自己又是一句完整提問、或太長 → 不算回答反問', () => {
    const h = [{ role: 'bot' as const, text: '是哪一台呢？' }]
    expect(isReplyingToBotQuestion(h, '那除濕機多少錢？')).toBe(false)
    expect(isReplyingToBotQuestion(h, '我想問一下你們那台除濕機的詳細規格')).toBe(false)
  })

  it('無 history → false', () => {
    expect(isReplyingToBotQuestion(undefined, '枕頭')).toBe(false)
    expect(isReplyingToBotQuestion([], '枕頭')).toBe(false)
  })
})

describe('dedupeByTitleContainment', () => {
  const c = (id: string, title: string): SimilarChunk => chunk({ id, title })
  it('同產品變體卡（標題互為包含）只留前面那張（D-3）', () => {
    const input = [
      c('1', 'NWT 威技 16L高效抽取型除濕機'),
      c('2', 'NWT威技16L高效抽取型除濕機專案資訊'), // 含 1 的標題 → 視為同產品
      c('3', 'NWT 威技 一級能效16L超威AI智能除濕機'), // 不同型號 → 保留
    ]
    expect(dedupeByTitleContainment(input).map(x => x.id)).toEqual(['1', '3'])
  })
  it('短標題（<4字）不互吃，避免誤併不同產品', () => {
    const input = [c('1', '燈'), c('2', '檯燈')]
    expect(dedupeByTitleContainment(input).map(x => x.id)).toEqual(['1', '2'])
  })
})

describe('isContextDependentFollowup', () => {
  it('只問屬性 / 指代詞的追問 → true', () => {
    for (const q of ['買多少錢呢', '價格多少', '有貨嗎', '什麼時候出貨', '怎麼用', '這個呢', '那台多少錢', '保固多久']) {
      expect(isContextDependentFollowup(q)).toBe(true)
    }
  })

  it('帶產品主題的獨立問題 → false（不該被併上下文拉歪）', () => {
    for (const q of ['空氣清淨機有什麼', '你們有賣什麼產品', 'LG 小蘑菇是什麼', '除濕機推薦']) {
      expect(isContextDependentFollowup(q)).toBe(false)
    }
  })
})

describe('socialCannedReply', () => {
  it('招呼 → 招呼罐頭', () => {
    for (const q of ['你好', '您好', '哈囉', '嗨', 'hi', 'Hello', '在嗎', '有人嗎', '早安', '你好！']) {
      expect(socialCannedReply(q)).toMatch(/為您服務/)
    }
  })
  it('道謝 → 不客氣罐頭', () => {
    for (const q of ['謝謝', '謝謝你', '感謝', '感恩', 'thanks', 'thx', '3Q']) {
      expect(socialCannedReply(q)).toMatch(/不客氣/)
    }
  })
  it('道別 → 再見罐頭', () => {
    for (const q of ['掰掰', '拜拜', '再見', 'bye']) {
      expect(socialCannedReply(q)).toMatch(/再見/)
    }
  })
  it('帶實際問題的句子 → null（不可誤攔）', () => {
    for (const q of ['你好我想問除濕機', '謝謝但這個多少錢', '哈囉小獴友多少錢', '請問營業時間']) {
      expect(socialCannedReply(q)).toBeNull()
    }
  })
})

describe('preferProductCards', () => {
  const c = (id: string, title: string): SimilarChunk => chunk({ id, title })
  it('把通用主題卡排到產品卡之後（穩定）', () => {
    const input = [
      c('1', '現貨庫存與預購說明'),
      c('2', 'NWT 威技 16L 除濕機'),
      c('3', '除濕機出廠測試現象說明'),
      c('4', 'GPLUS 居不可濕 除濕機'),
    ]
    expect(preferProductCards(input).map(x => x.id)).toEqual(['2', '4', '1', '3'])
  })
  it('候選全是主題卡時順序不變', () => {
    const input = [c('1', '除濕機保固政策'), c('2', '台灣在地保固與安全認證')]
    expect(preferProductCards(input).map(x => x.id)).toEqual(['1', '2'])
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
