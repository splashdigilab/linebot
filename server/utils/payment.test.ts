import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildPaidSubscription,
  INVOICE_ORDER_NO_MAX,
  newMerchantOrderNo,
  settlePaidOrder,
} from './payment'
import { invalidateWorkspaceSubscriptionCache } from './billing'
import type { WorkspaceSubscription } from '~~/shared/billing/plans'
import type { PaymentOrderDoc } from '~~/shared/types/payment'

// 2026-07-28（UTC 08:30 = 台灣 16:30）：月底,正是舊制會讓客戶「付整月只買到 3 天」的日子
const JUL28 = new Date(Date.UTC(2026, 6, 28, 8, 30, 15))

describe('buildPaidSubscription', () => {
  const existing = (over: Partial<WorkspaceSubscription> & Pick<WorkspaceSubscription, 'planId'>): WorkspaceSubscription => ({
    status: 'active', currentPeriodStart: '2026-07-28', currentPeriodEnd: '2026-08-27', anchorDay: 28, ...over,
  })

  it('無現有訂閱 → 從付款日起算完整一期（月底付款不再只買到月底）', () => {
    const sub = buildPaidSubscription('lite', JUL28)
    expect(sub).toEqual({
      planId: 'lite',
      status: 'active',
      currentPeriodStart: '2026-07-28',
      currentPeriodEnd: '2026-08-27',
      anchorDay: 28,
    })
    expect(sub.quotaOverride).toBeUndefined()
  })

  it('從免費層升級 → 立刻生效,錨定日重設為付款日（不接在免費期之後）', () => {
    const free = existing({ planId: 'free', currentPeriodStart: '2026-07-01', currentPeriodEnd: '2026-07-31', anchorDay: 1 })
    const sub = buildPaidSubscription('starter', JUL28, free)
    expect(sub.currentPeriodStart).toBe('2026-07-28')
    expect(sub.currentPeriodEnd).toBe('2026-08-27')
    expect(sub.anchorDay).toBe(28)
  })

  it('續訂同方案且未到期 → 期間堆疊、錨定日不變（提前續訂不白付）', () => {
    const sub = buildPaidSubscription('lite', JUL28, existing({ planId: 'lite' }))
    expect(sub.currentPeriodStart).toBe('2026-08-28')
    expect(sub.currentPeriodEnd).toBe('2026-09-27')
    expect(sub.anchorDay).toBe(28)
  })

  it('同方案但已過期 → 從付款日重新起算（不堆疊到過去）', () => {
    const sub = buildPaidSubscription('lite', JUL28, existing({ planId: 'lite', currentPeriodStart: '2026-05-01', currentPeriodEnd: '2026-05-31', anchorDay: 1 }))
    expect(sub.currentPeriodStart).toBe('2026-07-28')
  })

  it('換方案（升級）→ 立刻生效,不堆疊在舊方案之後', () => {
    const sub = buildPaidSubscription('pro', JUL28, existing({ planId: 'lite' }))
    expect(sub.planId).toBe('pro')
    expect(sub.currentPeriodStart).toBe('2026-07-28')
  })

  it('已解約的訂閱 → 不堆疊,從付款日重新起算', () => {
    const sub = buildPaidSubscription('lite', JUL28, existing({ planId: 'lite', status: 'canceled' }))
    expect(sub.currentPeriodStart).toBe('2026-07-28')
  })

  it('同方案續訂 → 保留 super admin 的 quotaOverride', () => {
    expect(buildPaidSubscription('pro', JUL28, existing({ planId: 'pro', quotaOverride: 15000 })).quotaOverride).toBe(15000)
  })

  it('換方案 → 不沿用舊 quotaOverride', () => {
    expect(buildPaidSubscription('pro', JUL28, existing({ planId: 'lite', quotaOverride: 15000 })).quotaOverride).toBeUndefined()
  })
})

describe('buildPaidSubscription — 定期定額（自動扣款委託）', () => {
  const existing = (over: Partial<WorkspaceSubscription> & Pick<WorkspaceSubscription, 'planId'>): WorkspaceSubscription => ({
    status: 'active', currentPeriodStart: '2026-07-28', currentPeriodEnd: '2026-08-27', anchorDay: 28, ...over,
  })

  it('帶 periodNo → 開啟自動續訂並記下委託單號（到期改走寬限期而非直接降級）', () => {
    const sub = buildPaidSubscription('starter', JUL28, null, { periodNo: 'P123', periodOrderNo: 'NP1', anchorDay: 28 })
    expect(sub.autoRenew).toBe(true)
    expect(sub.periodNo).toBe('P123')
    expect(sub.periodOrderNo).toBe('NP1') // 取消時 AlterStatus 要 MerOrderNo + PeriodNo 成對
  })

  it('定期定額**不堆疊** —— 錨定日必須跟藍新的 PeriodPoint 同一天', () => {
    // 若沿用舊訂閱的錨定日（堆疊），我方續期日就會跟藍新扣款日錯開，
    // 每個月都會出現「我方到期進寬限期 → 藍新還沒到扣款日 → 寬限期滿 → 把有在付錢的客戶降級」。
    const old = existing({ planId: 'lite', currentPeriodStart: '2026-07-05', currentPeriodEnd: '2026-08-04', anchorDay: 5 })
    const sub = buildPaidSubscription('lite', JUL28, old, { periodNo: 'P123', periodOrderNo: 'NP1', anchorDay: 28 })
    expect(sub.currentPeriodStart).toBe('2026-07-28') // 立刻生效，不接在 8/5
    expect(sub.anchorDay).toBe(28) // ← 跟 PeriodPoint 一致
  })

  it('錨定日沿用「建單時」存下的值，不在開通時重算（跨午夜會差一天）', () => {
    // 23:59 建單（PeriodPoint=27）、00:00 開通：若在這裡用 now 重算就會拿到 28，
    // 之後每個月藍新在 27 號扣款、我方在 28 號才續期 → 客戶每月被推進寬限期。
    const sub = buildPaidSubscription('starter', JUL28, null, { periodNo: 'P123', anchorDay: 27 })
    expect(sub.anchorDay).toBe(27)
    expect(sub.currentPeriodEnd).toBe('2026-08-26') // 下一次錨定日 8/27 的前一天
  })
})

describe('newMerchantOrderNo', () => {
  it('NP + 12 碼時間 + 3 碼亂數 = 17 碼，僅英數', () => {
    const no = newMerchantOrderNo(new Date(Date.UTC(2026, 6, 20, 8, 30, 15)), 'AB1')
    expect(no).toBe('NP260720083015AB1')
    expect(no).toMatch(/^[0-9A-Za-z]+$/)
    expect(no).toHaveLength(17)
  })

  it('加上定期定額的期數後綴仍 ≤ 20 碼（ezPay 發票的自訂編號上限）', () => {
    // 藍新每期回拋的 OrderNo = `本單號_期數`。本單號一超過 17 碼，
    // 第 2 期之後的續期發票就會被 ezPay 全部退件——recurring 客戶一輩子只拿得到一張發票。
    const no = newMerchantOrderNo(new Date(Date.UTC(2026, 6, 20, 8, 30, 15)), 'AB1')
    expect(`${no}_99`.length).toBeLessThanOrEqual(INVOICE_ORDER_NO_MAX)
    expect(`${no}_99`).toMatch(/^[0-9A-Za-z_]+$/) // ezPay 限英數與底線
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

  it('pending + 付款成功 → 結算並原子開通訂閱（從付款日起算完整一期）', async () => {
    const db = makeDb({ 'paymentOrders/NP1': pendingOrder() }) as any
    const r = await settlePaidOrder({ merchantOrderNo: 'NP1', paid: true, amount: 499, tradeNo: 'T9', paymentType: 'CREDIT', now: JUL28 }, db)

    expect(r.outcome).toBe('settled')
    const order = db._store.get('paymentOrders/NP1')
    expect(order.status).toBe('paid')
    expect(order.tradeNo).toBe('T9')
    expect(order.periodStart).toBe('2026-07-28')

    const ws = db._store.get('workspaces/ws1')
    expect(ws.subscription).toMatchObject({ planId: 'lite', status: 'active', currentPeriodStart: '2026-07-28', currentPeriodEnd: '2026-08-27' })
  })

  it('帳號已有同方案的有效訂閱 → 結算時期間堆疊(提前續訂不白付)', async () => {
    const db = makeDb({
      'paymentOrders/NP1': pendingOrder({ planId: 'lite', amount: 499 }),
      'workspaces/ws1': { subscription: { planId: 'lite', status: 'active', currentPeriodStart: '2026-07-28', currentPeriodEnd: '2026-08-27', anchorDay: 28 } },
    }) as any
    await settlePaidOrder({ merchantOrderNo: 'NP1', paid: true, amount: 499, now: JUL28 }, db)
    expect(db._store.get('workspaces/ws1').subscription.currentPeriodStart).toBe('2026-08-28')
  })

  it('付款失敗 → 訂單 failed、不開通訂閱', async () => {
    const db = makeDb({ 'paymentOrders/NP1': pendingOrder() }) as any
    const r = await settlePaidOrder({ merchantOrderNo: 'NP1', paid: false, now: JUL28 }, db)

    expect(r.outcome).toBe('settled')
    expect(db._store.get('paymentOrders/NP1').status).toBe('failed')
    expect(db._store.get('workspaces/ws1')).toBeUndefined()
  })

  it('已結算（redelivery）→ 冪等跳過、不覆蓋', async () => {
    const db = makeDb({ 'paymentOrders/NP1': pendingOrder({ status: 'paid', tradeNo: 'ORIG' }) }) as any
    const r = await settlePaidOrder({ merchantOrderNo: 'NP1', paid: true, tradeNo: 'DUP', now: JUL28 }, db)

    expect(r.outcome).toBe('already')
    expect(db._store.get('paymentOrders/NP1').tradeNo).toBe('ORIG')
    expect(db._store.get('workspaces/ws1')).toBeUndefined()
  })

  it('查無訂單 → unknown', async () => {
    const db = makeDb() as any
    expect((await settlePaidOrder({ merchantOrderNo: 'NOPE', paid: true, now: JUL28 }, db)).outcome).toBe('unknown')
  })

  it('金額不符 → 標記失敗、不開通', async () => {
    const db = makeDb({ 'paymentOrders/NP1': pendingOrder({ amount: 499 }) }) as any
    const r = await settlePaidOrder({ merchantOrderNo: 'NP1', paid: true, amount: 1, now: JUL28 }, db)
    expect(r.amountMismatch).toBe(true)
    expect(db._store.get('paymentOrders/NP1').status).toBe('failed')
    expect(db._store.get('workspaces/ws1')).toBeUndefined()
  })
})

