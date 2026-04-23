import { beforeAll, describe, expect, it } from 'vitest'
import {
  UPLOAD_ERROR_MESSAGES,
  UPLOAD_SIZE_EXCEEDED_MESSAGES,
} from '~~/shared/upload-errors'
import { validateUploadPayload } from '~~/server/utils/upload-validator'

beforeAll(() => {
  ;(globalThis as any).createError = ({ statusCode, statusMessage }: { statusCode: number; statusMessage: string }) => {
    const err = new Error(statusMessage) as Error & { statusCode?: number; statusMessage?: string }
    err.statusCode = statusCode
    err.statusMessage = statusMessage
    return err
  }
})

describe('validateUploadPayload', () => {
  it('rejects when fileBase64 is missing', () => {
    expect(() => validateUploadPayload({
      base64Input: '',
      contentType: 'image/png',
    })).toThrow(UPLOAD_ERROR_MESSAGES.FILE_BASE64_REQUIRED)
  })

  it('rejects unsupported MIME type', () => {
    expect(() => validateUploadPayload({
      base64Input: Buffer.from('ok').toString('base64'),
      contentType: 'image/gif',
    })).toThrow(UPLOAD_ERROR_MESSAGES.UNSUPPORTED_CONTENT_TYPE)
  })

  it('rejects payload larger than max size', () => {
    const oversizedBuffer = Buffer.alloc((500 * 1024) + 1, 'a')
    expect(() => validateUploadPayload({
      base64Input: oversizedBuffer.toString('base64'),
      contentType: 'image/png',
    })).toThrow(UPLOAD_SIZE_EXCEEDED_MESSAGES.image)
  })

  it('rejects non-image when allowedCategories is image-only', () => {
    expect(() => validateUploadPayload({
      base64Input: Buffer.from('video').toString('base64'),
      contentType: 'video/mp4',
      allowedCategories: ['image'],
    })).toThrow(UPLOAD_ERROR_MESSAGES.UNSUPPORTED_CONTENT_TYPE)
  })

  it('accepts valid image payload', () => {
    const result = validateUploadPayload({
      base64Input: Buffer.from('valid-image').toString('base64'),
      contentType: 'image/png',
    })
    expect(result.category).toBe('image')
    expect(result.contentType).toBe('image/png')
    expect(result.buffer.length).toBeGreaterThan(0)
  })
})
