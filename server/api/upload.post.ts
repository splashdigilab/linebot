import { v4 as uuidv4 } from 'uuid'
import { getStorage } from '../utils/firebase'
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

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const base64Input = body?.fileBase64 ?? body?.imageBase64
  const contentType = String(body?.contentType || '').trim()
  const IMAGE_TYPES = new Set(IMAGE_MIME_TYPES)
  const VIDEO_TYPES = new Set(VIDEO_MIME_TYPES)
  const AUDIO_TYPES = new Set(AUDIO_MIME_TYPES)
  const FILE_TYPES = new Set(FILE_MIME_TYPES)

  if (!base64Input) {
    throw createError({ statusCode: 400, statusMessage: 'fileBase64 is required' })
  }

  // extract actual image bytes from the base64 prefix if needed
  // typically the frontend sends a pure base64 string, but it might have data:image/png;base64,
  let pureBase64 = String(base64Input)
  if (pureBase64.includes('base64,')) {
    pureBase64 = pureBase64.split('base64,')[1]
  }

  const imageBuffer = Buffer.from(pureBase64, 'base64')
  const isVideo = VIDEO_TYPES.has(contentType)
  const isImage = IMAGE_TYPES.has(contentType)
  const isAudio = AUDIO_TYPES.has(contentType)
  const isFile = FILE_TYPES.has(contentType)
  const maxBytes = isVideo
    ? VIDEO_MAX_BYTES
    : isImage
      ? IMAGE_MAX_BYTES
      : isAudio
        ? AUDIO_MAX_BYTES
        : FILE_MAX_BYTES

  if (!isImage && !isVideo && !isAudio && !isFile) {
    throw createError({ statusCode: 400, statusMessage: 'unsupported contentType' })
  }
  if (imageBuffer.length > maxBytes) {
    const statusMessage = isVideo
      ? 'video exceeds 5MB limit'
      : isImage
        ? 'image exceeds 500KB limit'
        : isAudio
          ? 'audio exceeds 5MB limit'
          : 'file exceeds 5MB limit'
    throw createError({
      statusCode: 400,
      statusMessage,
    })
  }
  
  const id = uuidv4()
  const storage = getStorage()
  const bucket = storage.bucket()
  
  // Decide extension
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
  const ext = extMap[contentType] ?? 'bin'
  const folder = isVideo ? 'videos' : isAudio ? 'audios' : isFile ? 'files' : 'uploads'

  const fileName = `${folder}/${id}.${ext}`
  const file = bucket.file(fileName)
  
  await file.save(imageBuffer, { contentType: contentType || 'application/octet-stream' })
  await file.makePublic()
  
  const imageUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`

  return { imageUrl, url: imageUrl }
})
