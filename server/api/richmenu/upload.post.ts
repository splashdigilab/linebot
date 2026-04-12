export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { richMenuId, firestoreId, imageBase64, contentType } = body

  if (!richMenuId || !imageBase64) {
    throw createError({ statusCode: 400, statusMessage: 'richMenuId and imageBase64 are required' })
  }

  const imageBuffer = Buffer.from(imageBase64, 'base64')

  await uploadRichMenuImage(richMenuId, imageBuffer, contentType ?? 'image/png')

  const storage = getStorage()
  const bucket = storage.bucket()
  const fileName = `richmenus/${richMenuId}.${contentType === 'image/jpeg' ? 'jpg' : 'png'}`
  const file = bucket.file(fileName)
  await file.save(imageBuffer, { contentType })
  await file.makePublic()
  const imageUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`

  let aliasResult: { aliasId?: string; error?: string } = {}

  if (firestoreId) {
    await updateDoc('richmenus', firestoreId, { imageUrl })

    // Create alias AFTER image is uploaded (LINE requires image to exist first)
    const aliasId = `menu-${firestoreId}`

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
