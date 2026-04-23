import {
  AUDIO_MAX_BYTES,
  AUDIO_MIME_TYPES,
  FILE_MAX_BYTES,
  FILE_MIME_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_MIME_TYPES,
  VIDEO_MAX_BYTES,
  VIDEO_MIME_TYPES,
} from '~~/shared/upload-rules'
import {
  UPLOAD_ERROR_MESSAGES,
  UPLOAD_SIZE_EXCEEDED_MESSAGES,
} from '~~/shared/upload-errors'

export type UploadCategory = 'image' | 'video' | 'audio' | 'file'

const MIME_SETS: Record<UploadCategory, Set<string>> = {
  image: new Set(IMAGE_MIME_TYPES),
  video: new Set(VIDEO_MIME_TYPES),
  audio: new Set(AUDIO_MIME_TYPES),
  file: new Set(FILE_MIME_TYPES),
}

const MAX_BYTES_BY_CATEGORY: Record<UploadCategory, number> = {
  image: IMAGE_MAX_BYTES,
  video: VIDEO_MAX_BYTES,
  audio: AUDIO_MAX_BYTES,
  file: FILE_MAX_BYTES,
}

export function parseBase64Input(base64Input: unknown): Buffer {
  const source = String(base64Input || '').trim()
  if (!source) {
    throw createError({ statusCode: 400, statusMessage: UPLOAD_ERROR_MESSAGES.FILE_BASE64_REQUIRED })
  }

  const pureBase64 = source.includes('base64,')
    ? source.split('base64,')[1]
    : source

  return Buffer.from(pureBase64, 'base64')
}

export function detectUploadCategory(contentType: unknown): UploadCategory | null {
  const normalized = String(contentType || '').trim()
  if (!normalized) return null
  if (MIME_SETS.image.has(normalized)) return 'image'
  if (MIME_SETS.video.has(normalized)) return 'video'
  if (MIME_SETS.audio.has(normalized)) return 'audio'
  if (MIME_SETS.file.has(normalized)) return 'file'
  return null
}

export function validateUploadPayload(input: {
  base64Input: unknown
  contentType: unknown
  allowedCategories?: UploadCategory[]
}) {
  const { base64Input, contentType, allowedCategories = ['image', 'video', 'audio', 'file'] } = input
  const buffer = parseBase64Input(base64Input)
  const category = detectUploadCategory(contentType)

  if (!category || !allowedCategories.includes(category)) {
    throw createError({ statusCode: 400, statusMessage: UPLOAD_ERROR_MESSAGES.UNSUPPORTED_CONTENT_TYPE })
  }

  const maxBytes = MAX_BYTES_BY_CATEGORY[category]
  if (buffer.length > maxBytes) {
    throw createError({
      statusCode: 400,
      statusMessage: UPLOAD_SIZE_EXCEEDED_MESSAGES[category],
    })
  }

  return { buffer, category, contentType: String(contentType).trim() }
}

export function getUploadFileExtension(contentType: string): string {
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'video/mp4': 'mp4',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'application/x-zip-compressed': 'zip',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/plain': 'txt',
  }
  return extMap[contentType] ?? 'bin'
}

export function getUploadFolder(category: UploadCategory): string {
  if (category === 'video') return 'videos'
  if (category === 'audio') return 'audios'
  if (category === 'file') return 'files'
  return 'uploads'
}
