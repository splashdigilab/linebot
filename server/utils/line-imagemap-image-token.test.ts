import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImagemapImageToken, verifyImagemapImageToken } from './line-imagemap-image-token'

const SECRET = 'test_channel_secret'
const IMAGE_URL = 'https://storage.example.com/rich/abc.png'
const BUCKET_MS = 30 * 24 * 60 * 60 * 1000

describe('imagemap image token', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('round-trips: created token verifies back to the image URL', () => {
    const token = createImagemapImageToken(IMAGE_URL, SECRET)
    expect(verifyImagemapImageToken(token, SECRET)).toBe(IMAGE_URL)
  })

  it('is stable within the same 30-day bucket (cacheable baseUrl)', () => {
    const bucketStart = 100 * BUCKET_MS
    vi.spyOn(Date, 'now').mockReturnValue(bucketStart + 1000)
    const first = createImagemapImageToken(IMAGE_URL, SECRET)
    // 同桶尾端再簽一次,token 必須完全相同,LINE 端快取才有效
    vi.spyOn(Date, 'now').mockReturnValue(bucketStart + BUCKET_MS - 1000)
    const second = createImagemapImageToken(IMAGE_URL, SECRET)
    expect(second).toBe(first)
  })

  it('stays valid for at least a full bucket after rollover', () => {
    const bucketStart = 100 * BUCKET_MS
    vi.spyOn(Date, 'now').mockReturnValue(bucketStart + BUCKET_MS - 1000)
    const token = createImagemapImageToken(IMAGE_URL, SECRET)
    // 換桶後 30 天內舊 token 仍要能用(聊天室裡的舊訊息還會回頭抓圖)
    vi.spyOn(Date, 'now').mockReturnValue(bucketStart + 2 * BUCKET_MS - 1000)
    expect(verifyImagemapImageToken(token, SECRET)).toBe(IMAGE_URL)
    // 超過 exp 後拒絕
    vi.spyOn(Date, 'now').mockReturnValue(bucketStart + 2 * BUCKET_MS + 1000)
    expect(verifyImagemapImageToken(token, SECRET)).toBeNull()
  })

  it('rejects a token signed with a different secret', () => {
    const token = createImagemapImageToken(IMAGE_URL, 'other_secret')
    expect(verifyImagemapImageToken(token, SECRET)).toBeNull()
  })
})
