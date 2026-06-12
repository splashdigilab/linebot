import { describe, expect, it } from 'vitest'
import { computeDiff, contentSimilarity } from './ai-knowledge-resync'

const oldChunk = (id: string, title: string, content: string, manual = false) => ({
  id,
  title,
  content,
  tags: [],
  manuallyEditedAtMs: manual ? 1 : 0,
})
const newChunk = (title: string, content: string) => ({ title, content, tags: [] })

describe('contentSimilarity', () => {
  it('相同內容 = 1，完全不同 ≈ 0', () => {
    expect(contentSimilarity('滿千免運，離島另計', '滿千免運，離島另計')).toBe(1)
    expect(contentSimilarity('滿千免運，離島另計', 'abcdefg')).toBe(0)
  })

  it('小幅改寫仍維持高相似度', () => {
    const a = '本店滿一千元即享免運優惠，離島地區運費另外計算，預購商品出貨後約三到五個工作天送達。'
    const b = '本店滿一千元即享免運優惠，離島地區運費另計，預購商品出貨後約五到七個工作天送達。'
    expect(contentSimilarity(a, b)).toBeGreaterThan(0.6)
  })
})

describe('computeDiff 第二輪配對', () => {
  it('title 微調但內容幾乎相同 → modified 而非 removed+new', () => {
    const content = '本店滿一千元即享免運優惠，離島地區運費另外計算，預購商品約三到五天送達。'
    const { entries, summary } = computeDiff(
      [oldChunk('c1', '運費說明', content)],
      [newChunk('運費與配送說明', `${content}超商取貨另有折扣。`)],
    )
    expect(summary).toEqual({ added: 0, modified: 1, removed: 0, unchanged: 0 })
    expect(entries[0]!.kind).toBe('modified')
    expect(entries[0]!.oldChunk!.id).toBe('c1')
    expect(entries[0]!.newChunk!.title).toBe('運費與配送說明')
  })

  it('內容真的不同 → 維持 removed + new', () => {
    const { summary } = computeDiff(
      [oldChunk('c1', '運費說明', '滿千免運，離島另計，約三到五天送達。')],
      [newChunk('退換貨政策', '七天鑑賞期內可退換，需保持包裝完整，客製化商品不適用。')],
    )
    expect(summary).toEqual({ added: 1, modified: 0, removed: 1, unchanged: 0 })
  })

  it('title 完全相同仍走第一輪（unchanged / modified）', () => {
    const { summary } = computeDiff(
      [oldChunk('c1', '運費說明', '滿千免運。'), oldChunk('c2', '退換貨', '七天鑑賞期。')],
      [newChunk('運費說明', '滿千免運。'), newChunk('退換貨', '七天鑑賞期，客製品除外。')],
    )
    expect(summary).toEqual({ added: 0, modified: 1, removed: 0, unchanged: 1 })
  })

  it('手動編輯過的舊卡不參與第二輪 → 保守地出 removed(keep_old) + new(add_new)', () => {
    const content = '本店滿一千元即享免運優惠，離島地區運費另外計算，預購商品約三到五天送達。'
    const { entries, summary } = computeDiff(
      [oldChunk('c1', '運費說明', content, /* manual */ true)],
      [newChunk('運費與配送', content)],
    )
    expect(summary).toEqual({ added: 1, modified: 0, removed: 1, unchanged: 0 })
    const removed = entries.find(e => e.kind === 'removed')!
    expect(removed.defaultAction).toBe('keep_old')
    const added = entries.find(e => e.kind === 'new')!
    expect(added.defaultAction).toBe('add_new')
  })
})
