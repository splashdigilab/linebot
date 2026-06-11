export type MediaNaturalSize = {
  width: number
  height: number
}

export type PreviewFrameFit = 'contain' | 'cover'

// 此檔在 shared/ 會被 server 端 tsconfig 一起檢查（無 DOM lib），
// 瀏覽器全域改經 globalThis 取得並在執行期防呆。
export function loadImageNaturalSize(src: string): Promise<MediaNaturalSize> {
  return new Promise((resolve, reject) => {
    const ImageCtor = (globalThis as any).Image
    if (!ImageCtor) {
      reject(new Error('loadImageNaturalSize is browser-only'))
      return
    }
    const img = new ImageCtor()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = reject
    img.src = src
  })
}

export function loadVideoNaturalSize(src: string): Promise<MediaNaturalSize> {
  return new Promise((resolve, reject) => {
    const doc = (globalThis as any).document
    if (!doc) {
      reject(new Error('loadVideoNaturalSize is browser-only'))
      return
    }
    const video = doc.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight })
    video.onerror = reject
    video.src = src
  })
}

/**
 * 固定比例框的雙層 style。
 *
 * 設計原理（兩層 div）：
 *   外層（wrapperStyle）：max-width 限制，使寬度不超過 maxHeight × W/H
 *   內層（innerStyle）  ：width:100% + aspect-ratio → 高度從自身寬度算出，絕對可靠
 *
 * 為何不用單層 padding-top：padding-top% 是相對父容器寬度，
 * 若外層比內層寬則高度算錯。
 */
export function fixedFrameLayout(
  widthRatio: number,
  heightRatio: number,
  options?: { maxHeight?: string },
): {
  wrapperStyle: Record<string, string>
  innerStyle: Record<string, string>
} {
  // Guard against NaN / invalid values
  const w = Number.isFinite(widthRatio) && widthRatio > 0 ? widthRatio : 1
  const h = Number.isFinite(heightRatio) && heightRatio > 0 ? heightRatio : 1

  // 外層：永遠撐滿父層寬度（卡片內 100%）
  const wrapperStyle: Record<string, string> = {
    width: '100%',
    maxWidth: '100%',
  }

  // 內層：width:100% + padding-top 撐出高度（padding% 以外層寬度為基準）
  const innerStyle: Record<string, string> = {
    width: '100%',
    paddingTop: `${(h / w) * 100}%`,
  }
  return { wrapperStyle, innerStyle }
}

/** 將寬高簡化為互質整數，避免極大數值造成樣式計算異常 */
export function simplifyAspectRatio(width: number, height: number): { width: number, height: number } {
  let w = Math.max(1, Math.round(width))
  let h = Math.max(1, Math.round(height))
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const d = gcd(w, h)
  return { width: w / d, height: h / d }
}

/**
 * 自由比例預覽框（.fuz-preview）的 inline style。
 * 圖片為 in-flow 元素（height: auto），高度由圖片自然撐開。
 * 尺寸已知時設 aspect-ratio 防 CLS；未知時寬度 100%。
 */
export function naturalFrameStyle(
  size: MediaNaturalSize | null | undefined,
): Record<string, string> {
  const w = Number(size?.width || 0)
  const h = Number(size?.height || 0)
  if (w > 0 && h > 0) {
    return { aspectRatio: `${w} / ${h}`, width: '100%', maxWidth: '100%' }
  }
  return { width: '100%', maxWidth: '100%' }
}

/** LINE Flex aspectRatio 字串（如 16:9）→ CSS aspect-ratio */
export function lineAspectRatioToCss(raw: unknown): string | null {
  const text = String(raw || '').trim()
  const match = text.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
  if (!match) return null
  const wv = Number(match[1])
  const hv = Number(match[2])
  if (!Number.isFinite(wv) || !Number.isFinite(hv) || wv <= 0 || hv <= 0) return null
  return `${wv} / ${hv}`
}

/** @deprecated use fixedFrameLayout */
export function fixedPreviewFrameStyle(
  widthRatio: number,
  heightRatio: number,
  options?: { maxHeight?: string },
): Record<string, string> {
  return fixedFrameLayout(widthRatio, heightRatio, options).innerStyle
}

/** @deprecated use naturalFrameStyle */
export function mediaPreviewFrameStyle(
  size: MediaNaturalSize | null | undefined,
): Record<string, string> {
  return naturalFrameStyle(size)
}
