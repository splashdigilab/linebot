import { describe, expect, it } from 'vitest'
import { verifyLineWebhookSignature } from './line'

describe('verifyLineWebhookSignature', () => {
  it('accepts Buffer body (same bytes as LINE raw POST)', async () => {
    const secret = 'test_channel_secret'
    const body = Buffer.from('{"events":[]}', 'utf8')
    const crypto = await import('node:crypto')
    const expected = crypto.createHmac('sha256', secret).update(body).digest('base64')
    await expect(
      verifyLineWebhookSignature(body, expected, { channelSecret: secret }),
    ).resolves.toBe(true)
  })

  it('rejects wrong signature', async () => {
    const body = Buffer.from('{"events":[]}', 'utf8')
    await expect(
      verifyLineWebhookSignature(body, 'wrong', { channelSecret: 'test_channel_secret' }),
    ).resolves.toBe(false)
  })
})
