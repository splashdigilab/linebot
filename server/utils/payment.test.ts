import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildFreeSubscription,
  buildPaidSubscription,
  isExpiredPaidSub,
  newMerchantOrderNo,
  settlePaidOrder,
} from './payment'
import { invalidateWorkspaceSubscriptionCache } from './billing'
import type { WorkspaceSubscription } from '~~/shared/billing/plans'
import type { PaymentOrderDoc } from '~~/shared/types/payment'

// 2026-07-20（UTC）：月中，用來驗週期會被夾到日曆月邊界
const JUL = new Date(Date.UTC(2026, 6, 20, 8, 30, 15))

describe('buildPaidSubscription', () => {
  const active = (over: Partial<WorkspaceSubscription> & Pick<WorkspaceSubscription, 'planId'>): WorkspaceSubscription => ({
    status: 'active', currentPeriodStart: '2026-07-01', currentPeriodEnd: '2026-07-31', ...over,
  })

  it('無現有訂閱 → 對齊當月、active、不帶 quotaOverride', () => {
    const sub = buildPaidSubscription('lite', JUL)
    expect(sub).toEqual({ planId: 'lite', status: 'active', currentPeriodStart: '2026-07-01', currentPeriodEnd: '2026-07-31' })
    expect(sub.quotaOverride).toBeUndefined()
  })
  it('續訂仍有效的訂閱 → 期間堆疊到下一個月(不重設當月、不白付)', () => {
    const sub = buildPaidSubscription('lite', JUL, active({ planId: 'lite' }))
    expect(sub.currentPeriodStart).toBe('2026-08-01')
    expect(sub.currentPeriodEnd).toBe('2026-08-31')
  })
  it('已過期的訂閱 → 回到當月(不堆疊)', () => {
    const sub = buildPaidSubscription('lite', JUL, active({ planId: 'lite', currentPeriodStart: '2026-05-01', currentPeriodEnd: '2026-05-31' }))
    expect(sub.currentPeriodStart).toBe('2026-07-01')
  })
  it('同方案續訂 → 保留 super admin 的 quotaOverride', () => {
    expect(buildPaidSubscription('pro', JUL, active({ planId: 'pro', quotaOverride: 15000 })).quotaOverride).toBe(15000)
  })
  it('換方案 → 不沿用舊 quotaOverride', () => {
    expect(buildPaidSubscription('pro', JUL, active({ planId: 'lite', quotaOverride: 15000 })).quotaOverride).toBeUndefined()
  })
})

describe('newMerchantOrderNo', () => {
  it('NP + 14 碼時間 + 4 碼亂數，僅英數且 <=30', () => {
    const no = newMerchantOrderNo(JUL, 'AB12')
    expect(no).toBe('NP20260720083015AB12')
    expect(no).toMatch(/^[0-9A-Za-z]+$/)
    expect(no.length).toBeLessThanOrEqual(30)
  })
})

// ── settlePaidOrder：以極簡 in-memory Firestore 模擬 transaction ──
function makeDb(initial: Record<string, unknown> = {}) {
  const store = new Map<string, any>(Object.entries(initial))
  const docRef = (collection: string, id: string) => ({
    _key: `${collection}/${id}`,
    async get() {
      const d = store.get(`${collection}/${id}`)
      return { exists: d !== undefined, data: () => d }
    },
    async create(data: any) {
      const k = `${collection}/${id}`
      if (store.has(k)) { const e: any = new Error('ALREADY_EXISTS'); e.code = 6; throw e }
      store.set(k, data)
    },
  })
  return {
    _store: store,
    collection: (c: string) => ({ doc: (id: string) => docRef(c, id) }),
    async runTransaction(fn: (tx: any) => any) {
      const tx = {
        get: (ref: any) => ref.get(),
        update: (ref: any, data: any) => store.set(ref._key, { ...(store.get(ref._key) || {}), ...data }),
        set: (ref: any, data: any) => store.set(ref._key, data),
      }
      return fn(tx)
    },
  }
}

function pendingOrder(over: Partial<PaymentOrderDoc> = {}): Record<string, unknown> {
  return { merchantOrderNo: 'NP1', workspaceId: 'ws1', planId: 'lite', amount: 499, status: 'pending', ...over }
}

describe('settlePaidOrder', () => {
  beforeEach(() => invalidateWorkspaceSubscriptionCache())

  it('pending + 付款成功 → 結算並原子開通訂閱', async () => {
    const db = makeDb({ 'paymentOrders/NP1': pendingOrder() }) as any
    const r = await settlePaidOrder({ merchantOrderNo: 'NP1', paid: true, amount: 499, tradeNo: 'T9', paymentType: 'CREDIT', now: JUL }, db)

    expect(r.outcome).toBe('settled')
    const order = db._store.get('paymentOrders/NP1')
    expect(order.status).toBe('paid')
    expect(order.tradeNo).toBe('T9')
    expect(order.periodStart).toBe('2026-07-01')

    const ws = db._store.get('workspaces/ws1')
    expect(ws.subscription).toMatchObject({ planId: 'lite', status: 'active', currentPeriodStart: '2026-07-01', currentPeriodEnd: '2026-07-31' })
  })

  it('帳號已有有效訂閱 → 結算時期間堆疊(續訂不重設當月)', async () => {
    const db = makeDb({
      'paymentOrders/NP1': pendingOrder({ planId: 'lite', amount: 499 }),
      'workspaces/ws1': { subscription: { planId: 'lite', status: 'active', currentPeriodStart: '2026-07-01', currentPeriodEnd: '2026-07-31' } },
    }) as any
    await settlePaidOrder({ merchantOrderNo: 'NP1', paid: true, amount: 499, now: JUL }, db)
    expect(db._store.get('workspaces/ws1').subscription.currentPeriodStart).toBe('2026-08-01')
  })

  it('付款失敗 → 訂單 failed、不開通訂閱', async () => {
    const db = makeDb({ 'paymentOrders/NP1': pendingOrder() }) as any
    const r = await settlePaidOrder({ merchantOrderNo: 'NP1', paid: false, now: JUL }, db)

    expect(r.outcome).toBe('settled')
    expect(db._store.get('paymentOrders/NP1').status).toBe('failed')
    expect(db._store.get('workspaces/ws1')).toBeUndefined()
  })

  it('已結算（redelivery）→ 冪等跳過、不覆蓋', async () => {
    const db = makeDb({ 'paymentOrders/NP1': pendingOrder({ status: 'paid', tradeNo: 'ORIG' }) }) as any
    const r = await settlePaidOrder({ merchantOrderNo: 'NP1', paid: true, tradeNo: 'DUP', now: JUL }, db)

    expect(r.outcome).toBe('already')
    expect(db._store.get('paymentOrders/NP1').tradeNo).toBe('ORIG')
    expect(db._store.get('workspaces/ws1')).toBeUndefined()
  })

  it('查無訂單 → unknown', async () => {
    const db = makeDb() as any
    expect((await settlePaidOrder({ merchantOrderNo: 'NOPE', paid: true, now: JUL }, db)).outcome).toBe('unknown')
  })

  it('金額不符 → 標記失敗、不開通', async () => {
    const db = makeDb({ 'paymentOrders/NP1': pendingOrder({ amount: 499 }) }) as any
    const r = await settlePaidOrder({ merchantOrderNo: 'NP1', paid: true, amount: 1, now: JUL }, db)
    expect(r.amountMismatch).toBe(true)
    expect(db._store.get('paymentOrders/NP1').status).toBe('failed')
    expect(db._store.get('workspaces/ws1')).toBeUndefined()
  })
})

describe('isExpiredPaidSub（陷阱 A:只降過期付費,跳過 free/canceled）', () => {
  const today = '2026-07-13'
  it('付費、已過期、active → true', () => {
    expect(isExpiredPaidSub({ planId: 'lite', status: 'active', currentPeriodStart: '2026-06-01', currentPeriodEnd: '2026-06-30' }, today)).toBe(true)
  })
  it('尚未到期 → false', () => {
    expect(isExpiredPaidSub({ planId: 'lite', status: 'active', currentPeriodStart: '2026-07-01', currentPeriodEnd: '2026-07-31' }, today)).toBe(false)
  })
  it('free 方案 → false（本來就靠日曆月重置）', () => {
    expect(isExpiredPaidSub({ planId: 'free', status: 'active', currentPeriodStart: '2026-06-01', currentPeriodEnd: null }, today)).toBe(false)
  })
  it('canceled → false（維持 grandfather,不改動）', () => {
    expect(isExpiredPaidSub({ planId: 'pro', status: 'canceled', currentPeriodStart: '2026-06-01', currentPeriodEnd: '2026-06-30' }, today)).toBe(false)
  })
  it('無訂閱 → false', () => {
    expect(isExpiredPaidSub(null, today)).toBe(false)
  })
})

describe('buildFreeSubscription', () => {
  it('降級為 free/active、無到期日', () => {
    expect(buildFreeSubscription('2026-07-13')).toEqual({ planId: 'free', status: 'active', currentPeriodStart: '2026-07-13', currentPeriodEnd: null })
  })
})
