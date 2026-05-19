import type { MediaNaturalSize } from './media-preview'

/** 圖文訊息 Flex / Imagemap 座標系寬度（LINE 建議 1040） */
export const RICH_MESSAGE_CANVAS_WIDTH = 1040

/** LINE 輪播 template：imageAspectRatio 僅支援此二種 */
export type CarouselImageAspectRatio = 'rectangle' | 'square'

export const DEFAULT_CAROUSEL_IMAGE_ASPECT_RATIO: CarouselImageAspectRatio = 'rectangle'

export const CAROUSEL_IMAGE_ASPECT_OPTIONS: Array<{
  id: CarouselImageAspectRatio
  label: string
  width: number
  height: number
}> = [
  { id: 'rectangle', label: '橫式 1.51:1（LINE 預設）', width: 151, height: 100 },
  { id: 'square', label: '正方形 1:1', width: 1, height: 1 },
]

export type ResolvedRichMessageLayout = {
  lineAspectRatio: string
  canvasWidth: number
  canvasHeight: number
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return Math.max(1, x)
}

/** 將上傳圖尺寸轉為 LINE Flex 可用的 aspectRatio（高不得超過寬的 3 倍） */
export function resolveRichMessageFromImageSize(
  width?: number,
  height?: number,
): ResolvedRichMessageLayout {
  let w = Math.max(1, Math.round(Number(width) || 1))
  let h = Math.max(1, Math.round(Number(height) || 1))
  if (h > w * 3) h = w * 3

  const canvasWidth = RICH_MESSAGE_CANVAS_WIDTH
  const canvasHeight = Math.max(1, Math.round((canvasWidth * h) / w))
  const divisor = gcd(w, h)
  return {
    lineAspectRatio: `${Math.round(w / divisor)}:${Math.round(h / divisor)}`,
    canvasWidth,
    canvasHeight,
  }
}

export function getRichMessageCanvasSize(
  heroImageWidth?: number,
  heroImageHeight?: number,
): { width: number; height: number } {
  const resolved = resolveRichMessageFromImageSize(heroImageWidth, heroImageHeight)
  return { width: resolved.canvasWidth, height: resolved.canvasHeight }
}

export function richMessageCanvasPaddingBottomPercent(
  heroImageWidth?: number,
  heroImageHeight?: number,
): string {
  const { canvasWidth, canvasHeight } = getRichMessageCanvasSize(heroImageWidth, heroImageHeight)
  return `${(canvasHeight / canvasWidth) * 100}%`
}

export function resolveCarouselImageAspectRatio(
  raw?: unknown,
): { id: CarouselImageAspectRatio; width: number; height: number } {
  const id = String(raw || '').trim() === 'square' ? 'square' : 'rectangle'
  const preset = CAROUSEL_IMAGE_ASPECT_OPTIONS.find((item) => item.id === id)
    ?? CAROUSEL_IMAGE_ASPECT_OPTIONS[0]!
  return { id: preset.id, width: preset.width, height: preset.height }
}

export function carouselAspectToPreviewSize(raw?: unknown): MediaNaturalSize {
  const { width, height } = resolveCarouselImageAspectRatio(raw)
  return { width, height }
}

// ── Flex Image Carousel ──────────────────────────────────────────────────────

/** Flex 圖片輪播可自訂比例（LINE Flex image aspectRatio，高不超過寬的 3 倍） */
export type FlexImageCarouselAspectRatio = '20:9' | '16:9' | '4:3' | '1:1'

export const DEFAULT_FLEX_IMAGE_CAROUSEL_ASPECT_RATIO: FlexImageCarouselAspectRatio = '16:9'

export const FLEX_IMAGE_CAROUSEL_ASPECT_OPTIONS: Array<{
  id: FlexImageCarouselAspectRatio
  label: string
  widthRatio: number
  heightRatio: number
}> = [
  { id: '20:9', label: '寬螢幕 20:9', widthRatio: 20, heightRatio: 9 },
  { id: '16:9', label: '橫式 16:9', widthRatio: 16, heightRatio: 9 },
  { id: '4:3',  label: '標準橫式 4:3', widthRatio: 4,  heightRatio: 3 },
  { id: '1:1',  label: '正方形 1:1',  widthRatio: 1,  heightRatio: 1 },
]

export function resolveFlexImageCarouselAspectRatio(raw?: unknown): {
  id: FlexImageCarouselAspectRatio
  widthRatio: number
  heightRatio: number
  lineAspectRatio: string
} {
  const str = String(raw || '').trim()
  const match = FLEX_IMAGE_CAROUSEL_ASPECT_OPTIONS.find(o => o.id === str)
    ?? FLEX_IMAGE_CAROUSEL_ASPECT_OPTIONS.find(o => o.id === DEFAULT_FLEX_IMAGE_CAROUSEL_ASPECT_RATIO)!
  return { id: match.id, widthRatio: match.widthRatio, heightRatio: match.heightRatio, lineAspectRatio: match.id }
}
