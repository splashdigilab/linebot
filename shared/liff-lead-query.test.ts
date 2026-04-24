import { describe, expect, it } from 'vitest'
import { parseLeadClaimFromQuery } from './liff-lead-query'

describe('parseLeadClaimFromQuery', () => {
  it('reads ct and c from top-level query', () => {
    const q = { ct: 'tok-1', c: 'c_abc', liffId: '2009-abc' }
    expect(parseLeadClaimFromQuery(q)).toEqual({ ct: 'tok-1', campaignCode: 'c_abc', liffId: '2009-abc' })
  })

  it('parses ct and c from liff.state when top-level missing', () => {
    const encoded = encodeURIComponent('?ct=tok-2&c=c_def&liffId=2009-def')
    const q = { 'liff.state': encoded }
    expect(parseLeadClaimFromQuery(q)).toEqual({ ct: 'tok-2', campaignCode: 'c_def', liffId: '2009-def' })
  })

  it('parses ct and c from liff.state full path format', () => {
    const encoded = encodeURIComponent('/liff/lead?ct=tok-path&c=c_path&liffId=2009-path')
    const q = { 'liff.state': encoded }
    expect(parseLeadClaimFromQuery(q)).toEqual({ ct: 'tok-path', campaignCode: 'c_path', liffId: '2009-path' })
  })

  it('parses ct and c from liff.state full URL format', () => {
    const encoded = encodeURIComponent('https://main.example.com/liff/lead?ct=tok-url&c=c_url&liffId=2009-url')
    const q = { 'liff.state': encoded }
    expect(parseLeadClaimFromQuery(q)).toEqual({ ct: 'tok-url', campaignCode: 'c_url', liffId: '2009-url' })
  })

  it('top-level wins over liff.state when both present', () => {
    const q = { ct: 'a', c: 'b', liffId: 'top-id', 'liff.state': encodeURIComponent('?ct=x&c=y&liffId=state-id') }
    expect(parseLeadClaimFromQuery(q)).toEqual({ ct: 'a', campaignCode: 'b', liffId: 'top-id' })
  })

  it('reads liffId from liff.referrer when missing in query', () => {
    const q = { ct: 'tok', c: 'code', 'liff.referrer': 'https://liff.line.me/2009545365-qwUyrRb6' }
    expect(parseLeadClaimFromQuery(q)).toEqual({ ct: 'tok', campaignCode: 'code', liffId: '2009545365-qwUyrRb6' })
  })
})
