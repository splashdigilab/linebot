import { v4 as uuidv4 } from 'uuid'
import { getStorage } from '../utils/firebase'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { imageBase64, contentType } = body

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
  
  const id = uuidv4()
  const storage = getStorage()
  const bucket = storage.bucket()
  
  // Decide extension
  const isJpeg = contentType === 'image/jpeg' || contentType === 'image/jpg'
  const ext = isJpeg ? 'jpg' : 'png'
  
  const fileName = `uploads/${id}.${ext}`
  const file = bucket.file(fileName)
  
  await file.save(imageBuffer, { contentType: contentType ?? 'image/png' })
  await file.makePublic()
  
  const imageUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`

  return { imageUrl }
})
