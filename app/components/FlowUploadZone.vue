<template>
  <div>
    <!-- ① simple：只顯示按鈕 + 狀態（圖文訊息背景圖、圖文選單） -->
    <div v-if="appearance === 'simple'" class="admin-upload-simple">
      <input
        ref="inputRef"
        type="file"
        :accept="acceptAttr"
        class="admin-hidden-input"
        @change="onFileChange"
      />
      <el-button
        type="primary"
        size="small"
        class="admin-btn-compact"
        :disabled="isUploading"
        @click="triggerPick"
      >
        {{ isUploading ? '上傳中...' : modelValue ? `重新選擇${type === 'video' ? '影片' : '圖片'}` : `選擇${type === 'video' ? '影片' : '圖片'}` }}
      </el-button>
      <span v-if="modelValue" class="admin-upload-status"><el-icon><CircleCheck /></el-icon> 已上傳</span>
      <p v-if="hint" class="text-xs text-muted admin-upload-hint">{{ hint }}</p>
    </div>

    <!-- ② 固定比例框（輪播縮圖、圖片輪播、影片封面）
         兩層 div：外層限制寬度，內層 width:100% + aspect-ratio 取得正確高度 -->
    <template v-else-if="isFramed">
      <!-- 外層：撐滿父層寬度 -->
      <div class="fuz-frame-host" :style="frameWrapperStyle">
        <!-- 內層：width:100% + aspect-ratio → 高度從自身寬度計算 -->
        <div class="fuz-frame" :style="frameInnerStyle">
          <img
            v-if="hasPreviewValue && type === 'image'"
            :src="modelValue"
            alt="preview"
            class="fuz-frame__media"
            @load="onImageLoadWithEmit"
          >
          <video
            v-else-if="hasPreviewValue && type === 'video'"
            :src="modelValue"
            class="fuz-frame__media"
            controls
            preload="metadata"
            @loadedmetadata="onVideoMetadataWithEmit"
          />
          <!-- 空框：可點擊上傳 -->
          <div
            v-else
            class="fuz-frame-empty"
            @click="triggerPick"
          >
            <div v-if="isUploading" class="fuz-uploading">
              <div class="spinner fuz-zone-spinner" />
              <span>上傳中...</span>
            </div>
            <div v-else class="fuz-idle">
              <el-icon class="fuz-icon"><Picture /></el-icon>
              <span v-if="label" class="fuz-label">{{ label }}</span>
              <el-button
                type="primary"
                size="small"
                class="admin-btn-compact fuz-upload-btn"
                @click.stop="triggerPick"
              >
                選擇圖片
              </el-button>
              <span v-if="hint" class="fuz-hint">{{ hint }}</span>
            </div>
          </div>
          <!-- hover 更換覆蓋層 -->
          <div v-if="hasPreviewValue" class="fuz-preview-overlay">
            <el-button
              type="primary"
              size="small"
              class="admin-btn-compact"
              @click="$emit('update:modelValue', '')"
            >
              更換{{ type === 'video' ? '影片' : '圖片' }}
            </el-button>
          </div>
        </div>
      </div>
      <input
        ref="inputRef"
        type="file"
        :accept="acceptAttr"
        class="admin-hidden-input"
        @change="onFileChange"
      />
    </template>

    <!-- ③ 自由比例（影片播放器、普通圖片） -->
    <template v-else>
      <div v-if="hasPreviewValue" class="fuz-preview" :style="frameStyle">
        <img
          v-if="type === 'image'"
          :src="modelValue"
          alt="preview"
          class="fuz-preview-img"
          @load="onImageLoadWithEmit"
        />
        <video
          v-else-if="type === 'video'"
          :src="modelValue"
          class="fuz-preview-img"
          controls
          preload="metadata"
          @loadedmetadata="onVideoMetadataWithEmit"
        />
        <div class="fuz-preview-overlay">
          <el-button
            type="primary"
            size="small"
            class="admin-btn-compact"
            @click="$emit('update:modelValue', '')"
          >
            更換{{ type === 'video' ? '影片' : '圖片' }}
          </el-button>
        </div>
      </div>
      <div
        v-else
        class="upload-zone fuz-zone"
        :class="{ uploading: isUploading }"
        @click="triggerPick"
      >
        <div v-if="isUploading" class="fuz-uploading">
          <div class="spinner fuz-zone-spinner" />
          <span>上傳中...</span>
        </div>
        <div v-else class="fuz-idle">
          <el-icon class="fuz-icon"><component :is="type === 'video' ? VideoCamera : Picture" /></el-icon>
          <span v-if="label" class="fuz-label">{{ label }}</span>
          <el-button
            type="primary"
            size="small"
            class="admin-btn-compact fuz-upload-btn"
            @click.stop="triggerPick"
          >
            選擇{{ type === 'video' ? '影片' : '圖片' }}
          </el-button>
          <span v-if="hint" class="fuz-hint">{{ hint }}</span>
        </div>
      </div>
      <input
        ref="inputRef"
        type="file"
        :accept="acceptAttr"
        class="admin-hidden-input"
        @change="onFileChange"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { CircleCheck, Picture, VideoCamera } from '@element-plus/icons-vue'
import {
  IMAGE_ACCEPT_ATTR,
  VIDEO_ACCEPT_ATTR,
} from '~~/shared/upload-rules'
import { loadImageNaturalSize, loadVideoNaturalSize } from '~~/shared/media-preview'
import type { PreviewFrameMode } from '~/composables/useMediaPreviewDimensions'

type LocalSelectedFile = {
  file: File
  dataUrl: string
  objectUrl: string
  contentType: string
  width?: number
  height?: number
}

const props = defineProps<{
  modelValue: string
  type?: 'image' | 'video'
  label?: string
  hint?: string
  previewHeight?: string
  previewFrame?: PreviewFrameMode
  appearance?: 'zone' | 'simple'
  uploadMode?: 'api' | 'local'
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void
  (e: 'uploading', val: boolean): void
  (e: 'file-selected', payload: LocalSelectedFile): void
  (e: 'image-sized', payload: { width: number; height: number }): void
  (e: 'video-sized', payload: { width: number; height: number }): void
  (e: 'error', message: string): void
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const isUploading = ref(false)
const lastObjectUrl = ref<string | null>(null)
const { readAsDataUrl, uploadToStorage, validateFile } = useMediaUpload()

const acceptAttr = computed(() =>
  props.type === 'video' ? VIDEO_ACCEPT_ATTR : IMAGE_ACCEPT_ATTR,
)

const mediaKind = computed(() => (props.type === 'video' ? 'video' : 'image') as 'image' | 'video')
const modelValueRef = computed(() => props.modelValue)
const previewFrameRef = computed(() => props.previewFrame ?? 'natural')

const {
  dimensions,
  frameWrapperStyle,
  frameInnerStyle,
  frameStyle,
  onImageLoad,
  onVideoMetadata,
  refreshFromUrl,
} = useMediaPreviewDimensions(modelValueRef, mediaKind, {
  maxHeight: computed(() => props.previewHeight),
  frame: previewFrameRef,
})

const isFramed = computed(() => previewFrameRef.value !== 'natural')
const hasPreviewValue = computed(() => String(props.modelValue || '').trim().length > 0)
const appearance = computed(() => props.appearance ?? 'zone')
const uploadMode = computed(() => props.uploadMode ?? 'api')

function triggerPick() {
  inputRef.value?.click()
}

function emitImageSized(size?: { width?: number; height?: number }) {
  const w = Number(size?.width || 0)
  const h = Number(size?.height || 0)
  if (w > 0 && h > 0) emit('image-sized', { width: w, height: h })
}

function emitVideoSized(size?: { width?: number; height?: number }) {
  const w = Number(size?.width || 0)
  const h = Number(size?.height || 0)
  if (w > 0 && h > 0) emit('video-sized', { width: w, height: h })
}

function onImageLoadWithEmit(event: Event) {
  onImageLoad(event)
  emitImageSized(dimensions.value ?? undefined)
}

function onVideoMetadataWithEmit(event: Event) {
  onVideoMetadata(event)
  emitVideoSized(dimensions.value ?? undefined)
}

const { showToast } = useAdminToast()

function emitError(message: string) {
  emit('error', message)
  showToast(message, 'error')
}

function clearLastObjectUrl() {
  if (lastObjectUrl.value) {
    URL.revokeObjectURL(lastObjectUrl.value)
    lastObjectUrl.value = null
  }
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const fileKind = props.type === 'video' ? 'video' : 'image'
  const validation = validateFile(file, fileKind)
  if (!validation.ok) {
    emitError(validation.message)
    input.value = ''
    return
  }

  isUploading.value = true
  emit('uploading', true)

  try {
    if (uploadMode.value === 'local') {
      const base64 = await readAsDataUrl(file)
      clearLastObjectUrl()
      const objectUrl = URL.createObjectURL(file)
      lastObjectUrl.value = objectUrl
      let size: { width: number; height: number } | undefined
      if (fileKind !== 'video') {
        size = await loadImageNaturalSize(objectUrl)
        emitImageSized(size)
      }
      emit('file-selected', {
        file,
        dataUrl: base64,
        objectUrl,
        contentType: file.type,
        width: size?.width,
        height: size?.height,
      })
      input.value = ''
      return
    }

    const uploadedUrl = await uploadToStorage(file)
    emit('update:modelValue', uploadedUrl)
    if (fileKind === 'image' && uploadedUrl) {
      const size = await loadImageNaturalSize(uploadedUrl)
      emitImageSized(size)
      void refreshFromUrl(uploadedUrl)
    }
    if (fileKind === 'video' && uploadedUrl) {
      const size = await loadVideoNaturalSize(uploadedUrl)
      emitVideoSized(size)
    }
  }
  catch {
    emitError('上傳失敗，請重試')
  }
  finally {
    isUploading.value = false
    emit('uploading', false)
    input.value = ''
  }
}

onBeforeUnmount(() => {
  clearLastObjectUrl()
})
</script>
