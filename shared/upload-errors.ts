export type SharedUploadCategory = 'image' | 'video' | 'audio' | 'file'

export const UPLOAD_ERROR_MESSAGES = {
  FILE_BASE64_REQUIRED: 'fileBase64 is required',
  UNSUPPORTED_CONTENT_TYPE: 'unsupported contentType',
} as const

export const UPLOAD_SIZE_EXCEEDED_MESSAGES: Record<SharedUploadCategory, string> = {
  image: 'image exceeds 500KB limit',
  video: 'video exceeds 5MB limit',
  audio: 'audio exceeds 5MB limit',
  file: 'file exceeds 5MB limit',
}

export const UPLOAD_FRONTEND_TYPE_ERROR_MESSAGES: Record<SharedUploadCategory, string> = {
  image: '僅支援 JPG / PNG 圖片',
  video: '僅支援 MP4 影片',
  audio: '僅支援 M4A / MP3 / WAV 音訊',
  file: '僅支援 PDF / Office / TXT / ZIP 檔案',
}

export const UPLOAD_FRONTEND_SIZE_ERROR_MESSAGES: Record<SharedUploadCategory, string> = {
  image: '圖片不能超過 500KB',
  video: '影片不能超過 5MB',
  audio: '音訊不能超過 5MB',
  file: '檔案不能超過 5MB',
}
