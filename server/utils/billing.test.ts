import { beforeEach, describe, expect, it } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import type { SubscriptionStatus, WorkspaceSubscription } from '~~/shared/billing/plans'
import { buildPlanView, defaultFreeSubscription, getWorkspaceSubscription, invalidateWorkspaceSubscriptionCache, resolveAnsweredQuota } from './billing'

/** 最小假 Firestore：只支援 collection('workspaces').doc(id).get()。 */
function fakeDb(subsByWid: Record<string, WorkspaceSubscription | undefined>): Firestore {
  return {
    collection: () => ({
      doc: (id: string) => ({
        get: async () => ({
          exists: true,
          data: () => ({ subscription: subsByWid[id] }),
        }),
      }),
    }),
  } as unknown as Firestore
}

function sub(planId: WorkspaceSubscription['planId'], status: SubscriptionStatus, quotaOverride?: number | null): WorkspaceSubscription {
  return { planId, status, currentPeriodStart: null, currentPeriodEnd: null, quotaOverride }
}

beforeEach(() => invalidateWorkspaceSubscriptionCache())

describe('resolveAnsweredQuota — 攔截策略', () => {
  it('無訂閱 → 不攔截（grandfather，避免誤鎖既有租戶）', async () => {
    const db = fakeDb({ ws_none: undefined })
    const r = await resolveAnsweredQuota('ws_none', db)
    expect(r.enforce).toBe(false)
    expect(r.quota).toBeNull()
    expect(r.planId).toBeNull()
  })

  it('active 方案 → 攔截，額度為方案預設', async () => {
    const db = fakeDb({ ws_pro: sub('pro', 'active') })
    const r = await resolveAnsweredQuota('ws_pro', db)
    expect(r.enforce).toBe(true)
    expect(r.quota).toBe(10_000)
    expect(r.planId).toBe('pro')
  })

  it('trialing 也算已開通 → 攔截', async () => {
    const db = fakeDb({ ws_trial: sub('starter', 'trialing') })
    const r = await resolveAnsweredQuota('ws_trial', db)
    expect(r.enforce).toBe(true)
    expect(r.quota).toBe(1_300)
  })

  it('past_due 仍計量（不因欠費獲得無限量）', async () => {
    const db = fakeDb({ ws_pastdue: sub('lite', 'past_due') })
    const r = await resolveAnsweredQuota('ws_pastdue', db)
    expect(r.enforce).toBe(true)
    expect(r.quota).toBe(700)
  })

  it('canceled → 視為未訂閱、不攔截', async () => {
    const db = fakeDb({ ws_cancel: sub('pro', 'canceled') })
    const r = await resolveAnsweredQuota('ws_cancel', db)
    expect(r.enforce).toBe(false)
    expect(r.planId).toBe('pro') // 仍回報方案供顯示，但不擋
  })

  it('quotaOverride 覆蓋方案預設', async () => {
    const db = fakeDb({ ws_ovr: sub('starter', 'active', 5_000) })
    const r = await resolveAnsweredQuota('ws_ovr', db)
    expect(r.enforce).toBe(true)
    expect(r.quota).toBe(5_000)
  })

  it('企業 active 無 override → 攔截但額度 null（不設上限）', async () => {
    const db = fakeDb({ ws_ent: sub('enterprise', 'active') })
    const r = await resolveAnsweredQuota('ws_ent', db)
    expect(r.enforce).toBe(true)
    expect(r.quota).toBeNull()
  })
})

describe('defaultFreeSubscription — 新建帳號預設訂閱', () => {
  it('回免費層、active（會被計量）、無到期日', () => {
    const s = defaultFreeSubscription('2026-07-03T00:00:00.000Z')
    expect(s.planId).toBe('free')
    expect(s.status).toBe('active')
    expect(s.currentPeriodStart).toBe('2026-07-03T00:00:00.000Z')
    expect(s.currentPeriodEnd).toBeNull()
  })

  it('掛上後 → resolveAnsweredQuota 會攔截於 200 則', async () => {
    const db = fakeDb({ ws_new: defaultFreeSubscription() })
    const r = await resolveAnsweredQuota('ws_new', db)
    expect(r.enforce).toBe(true)
    expect(r.quota).toBe(200)
    expect(r.planId).toBe('free')
  })
})

describe('buildPlanView — 前端顯示視圖', () => {
  it('未訂閱 → null（grandfather，前端不顯示額度）', () => {
    expect(buildPlanView(null)).toBeNull()
  })

  it('免費訂閱 → 免費視圖（200 則、無超量加購）', () => {
    const v = buildPlanView(sub('free', 'active'))
    expect(v?.id).toBe('free')
    expect(v?.name).toBe('免費')
    expect(v?.answeredQuota).toBe(200)
    expect(v?.overagePerReply).toBeNull()
  })

  it('quotaOverride 反映在視圖額度', () => {
    const v = buildPlanView(sub('starter', 'active', 5_000))
    expect(v?.answeredQuota).toBe(5_000)
  })
})

describe('getWorkspaceSubscription', () => {
  it('空 workspaceId 回 null', async () => {
    const db = fakeDb({})
    expect(await getWorkspaceSubscription('', db)).toBeNull()
  })

  it('讀得到訂閱', async () => {
    const db = fakeDb({ ws_a: sub('growth', 'active') })
    const s = await getWorkspaceSubscription('ws_a', db)
    expect(s?.planId).toBe('growth')
  })
})
