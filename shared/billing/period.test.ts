import { describe, expect, it } from 'vitest'
import { anchorDayOf, newSubscription, rollSubscriptionToCurrentPeriod } from './period'
import type { WorkspaceSubscription } from './plans'

const sub = (over: Partial<WorkspaceSubscription> & Pick<WorkspaceSubscription, 'planId'>): WorkspaceSubscription => ({
  status: 'active',
  currentPeriodStart: '2026-07-28',
  currentPeriodEnd: '2026-08-27',
  anchorDay: 28,
  ...over,
})

describe('anchorDayOf', () => {
  it('有 anchorDay → 直接用', () => {
    expect(anchorDayOf(sub({ planId: 'lite', anchorDay: 15 }))).toBe(15)
  })
  it('舊資料沒有 anchorDay → 由本期起日推回', () => {
    expect(anchorDayOf({ planId: 'lite', status: 'active', currentPeriodStart: '2026-07-09', currentPeriodEnd: null })).toBe(9)
  })
  it('什麼都沒有 → 1', () => {
    expect(anchorDayOf({ planId: 'free', status: 'active', currentPeriodStart: null, currentPeriodEnd: null })).toBe(1)
  })
})

describe('newSubscription', () => {
  it('錨定日預設 = 起始日當天,週期一整期', () => {
    expect(newSubscription('starter', '2026-07-28')).toEqual({
      planId: 'starter',
      status: 'active',
      currentPeriodStart: '2026-07-28',
      currentPeriodEnd: '2026-08-27',
      anchorDay: 28,
    })
  })
})

describe('rollSubscriptionToCurrentPeriod — 讀取時就地推算當期', () => {
  it('還在本期內 → 原封不動', () => {
    const r = rollSubscriptionToCurrentPeriod(sub({ planId: 'starter' }), '2026-08-10')
    expect(r.changed).toBe(false)
    expect(r.downgraded).toBe(false)
    expect(r.sub.currentPeriodStart).toBe('2026-07-28')
  })

  it('免費層過期 → 滾到下一期（額度歸零）,方案不變', () => {
    const r = rollSubscriptionToCurrentPeriod(sub({ planId: 'free' }), '2026-08-30')
    expect(r.changed).toBe(true)
    expect(r.downgraded).toBe(false)
    expect(r.sub.planId).toBe('free')
    expect(r.sub.currentPeriodStart).toBe('2026-08-28')
    expect(r.sub.currentPeriodEnd).toBe('2026-09-27')
  })

  it('付費方案到期沒續費 → 降回免費層', () => {
    const r = rollSubscriptionToCurrentPeriod(sub({ planId: 'pro' }), '2026-08-30')
    expect(r.downgraded).toBe(true)
    expect(r.sub.planId).toBe('free')
    expect(r.sub.status).toBe('active')
    expect(r.sub.currentPeriodStart).toBe('2026-08-28')
  })

  it('降級時特批額度（quotaOverride）一併失效', () => {
    const r = rollSubscriptionToCurrentPeriod(sub({ planId: 'pro', quotaOverride: 50_000 }), '2026-08-30')
    expect(r.sub.planId).toBe('free')
    expect(r.sub.quotaOverride).toBeUndefined()
  })

  it('enterprise / internal 不會被自動降級（走合約 / 由人管理）', () => {
    expect(rollSubscriptionToCurrentPeriod(sub({ planId: 'enterprise' }), '2026-08-30').sub.planId).toBe('enterprise')
    expect(rollSubscriptionToCurrentPeriod(sub({ planId: 'internal' }), '2026-08-30').sub.planId).toBe('internal')
    expect(rollSubscriptionToCurrentPeriod(sub({ planId: 'test' }), '2026-08-30').sub.planId).toBe('test')
  })

  it('休眠很久（跳過好幾期）→ 一路滾到當期,只降一次級', () => {
    const r = rollSubscriptionToCurrentPeriod(sub({ planId: 'pro' }), '2026-12-05')
    expect(r.sub.planId).toBe('free')
    // 7/28 起每月 28 號續期 → 包含 12/05 的那一期是 11/28 ~ 12/27
    expect(r.sub.currentPeriodStart).toBe('2026-11-28')
    expect(r.sub.currentPeriodEnd).toBe('2026-12-27')
  })

  it('舊資料沒有週期 → 就地補一期並補上 anchorDay', () => {
    const r = rollSubscriptionToCurrentPeriod(
      { planId: 'free', status: 'active', currentPeriodStart: null, currentPeriodEnd: null },
      '2026-07-28',
    )
    expect(r.changed).toBe(true)
    expect(r.sub).toMatchObject({ currentPeriodStart: '2026-07-28', currentPeriodEnd: '2026-08-27', anchorDay: 28 })
  })

  it('推算是冪等的：滾過一次之後再滾不會再變', () => {
    const once = rollSubscriptionToCurrentPeriod(sub({ planId: 'pro' }), '2026-08-30')
    const twice = rollSubscriptionToCurrentPeriod(once.sub, '2026-08-30')
    expect(twice.changed).toBe(false)
    expect(twice.sub).toEqual(once.sub)
  })

  it('舊版寫成完整 ISO 的起日 → 正規化成 YYYY-MM-DD（否則會變成額度桶的 doc id）', () => {
    const r = rollSubscriptionToCurrentPeriod(
      { planId: 'free', status: 'active', currentPeriodStart: '2026-07-03T00:00:00.000Z', currentPeriodEnd: null },
      '2026-07-28',
    )
    expect(r.sub.currentPeriodStart).toBe('2026-07-03')
    expect(r.sub.currentPeriodEnd).toBe('2026-08-02')
    expect(r.sub.anchorDay).toBe(3)
  })
})
