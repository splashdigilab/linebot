export const IMAGE_MIME_TYPES: string[] = ['image/jpeg', 'image/jpg', 'image/png']
export const VIDEO_MIME_TYPES: string[] = ['video/mp4']
export const AUDIO_MIME_TYPES: string[] = ['audio/mp4', 'audio/x-m4a', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav']
export const FILE_MIME_TYPES: string[] = [
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
]

export const IMAGE_MAX_BYTES = 500 * 1024
export const VIDEO_MAX_BYTES = 5 * 1024 * 1024
export const AUDIO_MAX_BYTES = 5 * 1024 * 1024
export const FILE_MAX_BYTES = 5 * 1024 * 1024

export const IMAGE_ACCEPT_ATTR = IMAGE_MIME_TYPES.join(',')
export const VIDEO_ACCEPT_ATTR = VIDEO_MIME_TYPES.join(',')
export const AUDIO_ACCEPT_ATTR = AUDIO_MIME_TYPES.join(',')
export const FILE_ACCEPT_ATTR = FILE_MIME_TYPES.join(',')
