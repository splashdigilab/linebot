import { describe, it, expect } from 'vitest'
import {
  escapeHtml,
  receiptEmail,
  chargeFailedEmail,
  renewalReminderEmail,
  quotaEmail,
} from './email-content'

describe('escapeHtml', () => {
  it('跳脫 HTML 特殊字元', () => {
    expect(escapeHtml('<script>&"\'')).toBe('&lt;script&gt;&amp;&quot;&#39;')
  })
  it('null/undefined 回空字串', () => {
    expect(escapeHtml(undefined as unknown as string)).toBe('')
  })
})

describe('receiptEmail', () => {
  const base = {
    brandName: 'MYFEEL',
    workspaceName: '小福商店',
    planName: '成長',
    amount: 1990,
    periodStart: '2026-07-20',
    periodEnd: '2026-08-19',
    recurring: true,
  }

  it('含方案、金額（千分位）、本期、自動續訂', () => {
    const { subject, html, text } = receiptEmail(base)
    expect(subject).toContain('付款成功')
    expect(subject).toContain('成長')
    expect(html).toContain('NT$1,990')
    expect(html).toContain('2026-07-20')
    expect(html).toContain('信用卡自動續訂')
    expect(text).toContain('NT$1,990')
    expect(text).toContain('信用卡自動續訂')
  })

  it('有發票號碼時才顯示發票欄', () => {
    expect(receiptEmail({ ...base, invoiceNumber: 'AB12345678' }).html).toContain('AB12345678')
    expect(receiptEmail(base).html).not.toContain('電子發票號碼')
  })

  it('單次付款顯示為單次付款', () => {
    const { html } = receiptEmail({ ...base, recurring: false })
    expect(html).toContain('單次付款')
    expect(html).not.toContain('信用卡自動續訂')
  })

  it('workspace 名稱經過 HTML 跳脫（防注入）', () => {
    const { html } = receiptEmail({ ...base, workspaceName: '<b>x</b>' })
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).not.toContain('<b>x</b>')
  })
})

describe('chargeFailedEmail', () => {
  it('主旨提到更新付款方式，內文帶管理連結', () => {
    const { subject, html, text } = chargeFailedEmail({
      brandName: 'MYFEEL', workspaceName: '小福商店', planName: '成長',
      manageUrl: 'https://app.example.com/admin/ws1/settings/billing',
    })
    expect(subject).toContain('扣款失敗')
    expect(html).toContain('https://app.example.com/admin/ws1/settings/billing')
    expect(text).toContain('https://app.example.com/admin/ws1/settings/billing')
  })
})

describe('renewalReminderEmail', () => {
  it('主旨含扣款日與方案，內文含金額', () => {
    const { subject, html } = renewalReminderEmail({
      brandName: 'MYFEEL', workspaceName: '小福商店', planName: '成長',
      amount: 1990, chargeDate: '2026-08-19',
      manageUrl: 'https://app.example.com/b',
    })
    expect(subject).toContain('2026-08-19')
    expect(subject).toContain('成長')
    expect(html).toContain('NT$1,990')
  })
})

describe('quotaEmail', () => {
  const base = {
    brandName: 'MYFEEL', workspaceName: '小福商店', planName: '免費',
    used: 200, quota: 200, manageUrl: 'https://app.example.com/b',
  }
  it('over：主旨為已用完、內文提到暫停自動回覆', () => {
    const { subject, html } = quotaEmail({ ...base, kind: 'over' })
    expect(subject).toContain('已用完')
    expect(html).toContain('暫停自動回覆')
    expect(html).toContain('200 / 200 則')
  })
  it('near：主旨為即將用完', () => {
    const { subject } = quotaEmail({ ...base, used: 170, kind: 'near' })
    expect(subject).toContain('即將用完')
  })
})
