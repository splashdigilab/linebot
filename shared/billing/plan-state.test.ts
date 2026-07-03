import { describe, expect, it } from 'vitest'
import { derivePlanState } from './plan-state'

describe('derivePlanState', () => {
  it('未訂閱（plan null）→ 無上限、ok', () => {
    const s = derivePlanState(null, 50)
    expect(s.limit).toBeNull()
    expect(s.remaining).toBeNull()
    expect(s.state).toBe('ok')
    expect(s.percentRaw).toBe(0)
  })

  it('用量 < 80% → ok', () => {
    const s = derivePlanState({ answeredQuota: 200 }, 100)
    expect(s.percentRaw).toBe(50)
    expect(s.remaining).toBe(100)
    expect(s.state).toBe('ok')
    expect(s.color).toBe('#0f7b54')
  })

  it('用量 ≥ 80% → near', () => {
    const s = derivePlanState({ answeredQuota: 200 }, 160)
    expect(s.percentRaw).toBe(80)
    expect(s.state).toBe('near')
  })

  it('用滿 → over；percent 夾在 100，percentRaw 反映實際、remaining 為 0', () => {
    const s = derivePlanState({ answeredQuota: 200 }, 260)
    expect(s.state).toBe('over')
    expect(s.percent).toBe(100)
    expect(s.percentRaw).toBe(130)
    expect(s.remaining).toBe(0)
  })

  it('客製額度（quota null）→ 無上限、ok', () => {
    const s = derivePlanState({ answeredQuota: null }, 99_999)
    expect(s.limit).toBeNull()
    expect(s.state).toBe('ok')
  })
})
