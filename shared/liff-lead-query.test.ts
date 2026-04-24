import { describe, expect, it } from 'vitest'
import { parseLeadClaimFromQuery } from './liff-lead-query'

describe('parseLeadClaimFromQuery', () => {
  it('reads ct and c from top-level query', () => {
    const q = { ct: 'tok-1', c: 'c_abc' }
    expect(parseLeadClaimFromQuery(q)).toEqual({ ct: 'tok-1', campaignCode: 'c_abc' })
  })

  it('parses ct and c from liff.state when top-level missing', () => {
    const encoded = encodeURIComponent('?ct=tok-2&c=c_def')
    const q = { 'liff.state': encoded }
    expect(parseLeadClaimFromQuery(q)).toEqual({ ct: 'tok-2', campaignCode: 'c_def' })
  })

  it('top-level wins over liff.state when both present', () => {
    const q = { ct: 'a', c: 'b', 'liff.state': encodeURIComponent('?ct=x&c=y') }
    expect(parseLeadClaimFromQuery(q)).toEqual({ ct: 'a', campaignCode: 'b' })
  })
})
