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
  UPLOAD_FRONTEND_SIZE_ERROR_MESSAGES,
  UPLOAD_FRONTEND_TYPE_ERROR_MESSAGES,
} from '~~/shared/upload-errors'

export type UploadMediaKind = 'image' | 'video' | 'audio' | 'file'

const MIME_TYPES_BY_KIND: Record<UploadMediaKind, string[]> = {
  image: IMAGE_MIME_TYPES,
  video: VIDEO_MIME_TYPES,
  audio: AUDIO_MIME_TYPES,
  file: FILE_MIME_TYPES,
}

const MAX_BYTES_BY_KIND: Record<UploadMediaKind, number> = {
  image: IMAGE_MAX_BYTES,
  video: VIDEO_MAX_BYTES,
  audio: AUDIO_MAX_BYTES,
  file: FILE_MAX_BYTES,
}

export function useMediaUpload() {
  function validateFile(file: File, kind: UploadMediaKind): { ok: boolean, message: string } {
    const allowTypes = new Set(MIME_TYPES_BY_KIND[kind])
    if (!allowTypes.has(file.type)) {
      return { ok: false, message: UPLOAD_FRONTEND_TYPE_ERROR_MESSAGES[kind] }
    }
    if (file.size > MAX_BYTES_BY_KIND[kind]) {
      return { ok: false, message: UPLOAD_FRONTEND_SIZE_ERROR_MESSAGES[kind] }
    }
    return { ok: true, message: '' }
  }

  function readAsDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function uploadToStorage(file: File): Promise<string> {
    const base64 = await readAsDataUrl(file)
    const res = await $fetch<{ imageUrl: string, url?: string }>('/api/upload', {
      method: 'POST',
      body: { fileBase64: base64, contentType: file.type },
    })
    return String(res.url || res.imageUrl || '').trim()
  }

  return {
    validateFile,
    readAsDataUrl,
    uploadToStorage,
  }
}
