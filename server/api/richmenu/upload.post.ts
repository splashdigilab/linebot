import { validateUploadPayload } from '~~/server/utils/upload-validator'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { richMenuId, firestoreId, imageBase64, contentType } = body

  if (!richMenuId || !imageBase64) {
    throw createError({ statusCode: 400, statusMessage: 'richMenuId and imageBase64 are required' })
  }

  const { buffer: imageBuffer, contentType: normalizedContentType } = validateUploadPayload({
    base64Input: imageBase64,
    contentType,
    allowedCategories: ['image'],
  })

  await uploadRichMenuImage(richMenuId, imageBuffer, normalizedContentType || 'image/png')

  const storage = getStorage()
  const bucket = storage.bucket()
  const fileName = `richmenus/${richMenuId}.${normalizedContentType === 'image/jpeg' || normalizedContentType === 'image/jpg' ? 'jpg' : 'png'}`
  const file = bucket.file(fileName)
  await file.save(imageBuffer, { contentType: normalizedContentType })
  await file.makePublic()
  const imageUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`

  let aliasResult: { aliasId?: string; error?: string } = {}

  if (firestoreId) {
    await updateDoc('richmenus', firestoreId, { imageUrl })

    // Get or derive aliasId — pure alphanumeric, no hyphens (LINE requirement)
    const stored = await getDoc<any>('richmenus', firestoreId)
    const aliasId = stored?.aliasId ?? `rm${firestoreId.replace(/-/g, '').slice(0, 28)}`

    // Delete existing alias first (ignore error if not exists)
    try { await deleteRichMenuAlias(aliasId) } catch {}

    try {
      await createRichMenuAlias(richMenuId, aliasId)
      await updateDoc('richmenus', firestoreId, { aliasId })
      aliasResult = { aliasId }
    } catch (e: any) {
      const errMsg = e?.message ?? String(e)
      console.warn('[upload] Failed to create alias:', errMsg)
      aliasResult = { error: errMsg }
    }
  }

  return { imageUrl, alias: aliasResult }
})
