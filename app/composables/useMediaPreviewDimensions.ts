import { toValue } from 'vue'
import {
  fixedFrameLayout,
  loadImageNaturalSize,
  naturalFrameStyle,
  type MediaNaturalSize,
  type PreviewFrameFit,
} from '~~/shared/media-preview'

export type PreviewFrameMode =
  | 'natural'
  | {
      widthRatio: number
      heightRatio: number
      fit: PreviewFrameFit
    }

export function useMediaPreviewDimensions(
  source: Ref<string | undefined>,
  kind: Ref<'image' | 'video' | undefined>,
  options?: {
    maxHeight?: Ref<string | undefined> | string
    frame?: Ref<PreviewFrameMode | undefined> | PreviewFrameMode
  },
) {
  const dimensions = ref<MediaNaturalSize | null>(null)
  let loadToken = 0

  const frameMode = computed((): PreviewFrameMode => {
    const raw = toValue(options?.frame)
    if (raw === 'natural' || raw === undefined) return 'natural'
    if (typeof raw === 'object' && raw.widthRatio > 0 && raw.heightRatio > 0) return raw
    return 'natural'
  })

  const maxHeight = computed(() => {
    const raw = toValue(options?.maxHeight)
    return typeof raw === 'string' ? raw : undefined
  })

  async function refreshFromUrl(url: string) {
    const token = ++loadToken
    try {
      const size = await loadImageNaturalSize(url)
      if (token === loadToken) dimensions.value = size
    }
    catch {
      if (token === loadToken) dimensions.value = null
    }
  }

  watch(
    [source, kind],
    ([url, mediaKind]) => {
      if (!url || mediaKind === 'video') {
        loadToken++
        if (!url) dimensions.value = null
        return
      }
      void refreshFromUrl(url)
    },
    { immediate: true },
  )

  function onImageLoad(event: Event) {
    const img = event.target as HTMLImageElement | null
    if (!img?.naturalWidth || !img?.naturalHeight) return
    dimensions.value = { width: img.naturalWidth, height: img.naturalHeight }
  }

  function onVideoMetadata(event: Event) {
    const video = event.target as HTMLVideoElement | null
    if (!video?.videoWidth || !video?.videoHeight) return
    dimensions.value = { width: video.videoWidth, height: video.videoHeight }
  }

  const previewFit = computed<PreviewFrameFit>(() => {
    const mode = frameMode.value
    if (mode === 'natural') return 'contain'
    return mode.fit
  })

  /**
   * 固定比例模式：外層 div 用 frameWrapperStyle（寬度限制），
   * 內層 .fuz-frame 用 frameInnerStyle（width:100% + aspect-ratio）。
   */
  const frameWrapperStyle = computed(() => {
    const mode = frameMode.value
    const mh = maxHeight.value
    if (mode === 'natural') return {}
    return fixedFrameLayout(mode.widthRatio, mode.heightRatio, { maxHeight: mh }).wrapperStyle
  })

  const frameInnerStyle = computed(() => {
    const mode = frameMode.value
    const mh = maxHeight.value
    if (mode === 'natural') return {}
    return fixedFrameLayout(mode.widthRatio, mode.heightRatio, { maxHeight: mh }).innerStyle
  })

  /** 自由比例模式的容器 style */
  const frameStyle = computed(() => naturalFrameStyle(dimensions.value))

  return {
    dimensions,
    frameWrapperStyle,
    frameInnerStyle,
    frameStyle,
    previewFit,
    onImageLoad,
    onVideoMetadata,
    refreshFromUrl,
  }
}
