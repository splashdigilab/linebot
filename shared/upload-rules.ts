export const IMAGE_MIME_TYPES: string[] = ['image/jpeg', 'image/jpg', 'image/png']
export const VIDEO_MIME_TYPES: string[] = ['video/mp4']

export const IMAGE_MAX_BYTES = 500 * 1024
export const VIDEO_MAX_BYTES = 5 * 1024 * 1024

export const IMAGE_ACCEPT_ATTR = IMAGE_MIME_TYPES.join(',')
export const VIDEO_ACCEPT_ATTR = VIDEO_MIME_TYPES.join(',')
