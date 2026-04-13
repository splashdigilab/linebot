import { v4 as uuidv4 } from 'uuid'
import { getStorage } from '../utils/firebase'
import {
  IMAGE_MAX_BYTES,
  IMAGE_MIME_TYPES,
  VIDEO_MAX_BYTES,
  VIDEO_MIME_TYPES,
} from '~~/shared/upload-rules'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { imageBase64, contentType } = body
  const IMAGE_TYPES = new Set(IMAGE_MIME_TYPES)
  const VIDEO_TYPES = new Set(VIDEO_MIME_TYPES)

  if (!imageBase64) {
    throw createError({ statusCode: 400, statusMessage: 'imageBase64 is required' })
  }

  // extract actual image bytes from the base64 prefix if needed
  // typically the frontend sends a pure base64 string, but it might have data:image/png;base64,
  let pureBase64 = imageBase64
  if (pureBase64.includes('base64,')) {
    pureBase64 = pureBase64.split('base64,')[1]
  }

  const imageBuffer = Buffer.from(pureBase64, 'base64')
  const isVideo = VIDEO_TYPES.has(contentType ?? '')
  const isImage = IMAGE_TYPES.has(contentType ?? '')
  const maxBytes = isVideo ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES

  if (!isImage && !isVideo) {
    throw createError({ statusCode: 400, statusMessage: 'unsupported contentType' })
  }
  if (imageBuffer.length > maxBytes) {
    throw createError({
      statusCode: 400,
      statusMessage: isVideo ? 'video exceeds 5MB limit' : 'image exceeds 500KB limit',
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
  }
  const ext = extMap[contentType ?? ''] ?? 'bin'
  const folder = (contentType ?? '').startsWith('video/') ? 'videos' : 'uploads'

  const fileName = `${folder}/${id}.${ext}`
  const file = bucket.file(fileName)
  
  await file.save(imageBuffer, { contentType: contentType ?? 'image/png' })
  await file.makePublic()
  
  const imageUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`

  return { imageUrl }
})
