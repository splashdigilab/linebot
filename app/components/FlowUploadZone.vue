<template>
  <div>
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
      <span v-if="modelValue" class="admin-upload-status">✅ 已上傳</span>
      <p v-if="hint" class="text-xs text-muted admin-upload-hint">{{ hint }}</p>
    </div>

    <!-- Preview state -->
    <div v-else-if="modelValue" class="fuz-preview" :style="previewStyle">
      <img v-if="type === 'image'" :src="modelValue" alt="preview" class="fuz-preview-img" />
      <video v-else-if="type === 'video'" :src="modelValue" class="fuz-preview-img" controls />
      <div class="fuz-preview-overlay">
        <el-button type="primary" size="small" class="admin-btn-compact" @click="$emit('update:modelValue', '')">
          更換{{ type === 'video' ? '影片' : '圖片' }}
        </el-button>
      </div>
    </div>

    <!-- Upload zone -->
    <div v-else class="upload-zone fuz-zone" :class="{ uploading: isUploading }" @click="triggerPick">
      <div v-if="isUploading" class="fuz-uploading">
        <div class="spinner fuz-zone-spinner" />
        <span>上傳中...</span>
      </div>
      <div v-else class="fuz-idle">
        <span class="fuz-icon">{{ type === 'video' ? '🎬' : '📷' }}</span>
        <span class="fuz-label">{{ label }}</span>
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

    <!-- Hidden file input -->
    <input
      v-if="appearance !== 'simple'"
      ref="inputRef"
      type="file"
      :accept="acceptAttr"
      class="admin-hidden-input"
      @change="onFileChange"
    />
  </div>
</template>

<script setup lang="ts">
import {
  IMAGE_ACCEPT_ATTR,
  VIDEO_ACCEPT_ATTR,
} from '~~/shared/upload-rules'

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
  appearance?: 'zone' | 'simple'
  uploadMode?: 'api' | 'local'
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void
  (e: 'uploading', val: boolean): void
  (e: 'file-selected', payload: LocalSelectedFile): void
  (e: 'error', message: string): void
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const isUploading = ref(false)
const lastObjectUrl = ref<string | null>(null)
const { readAsDataUrl, uploadToStorage, validateFile } = useMediaUpload()

const acceptAttr = computed(() =>
  props.type === 'video'
    ? VIDEO_ACCEPT_ATTR
    : IMAGE_ACCEPT_ATTR
)

const previewStyle = computed(() => ({
  height: props.previewHeight ?? '180px',
}))

const appearance = computed(() => props.appearance ?? 'zone')
const uploadMode = computed(() => props.uploadMode ?? 'api')

function triggerPick() {
  inputRef.value?.click()
}

function getImageSize(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = reject
    img.src = src
  })
}

function emitError(message: string) {
  emit('error', message)
  alert(message)
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

  const mediaKind = props.type === 'video' ? 'video' : 'image'
  const validation = validateFile(file, mediaKind)
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
      if (mediaKind !== 'video') {
        size = await getImageSize(objectUrl)
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
  } catch {
    emitError('上傳失敗，請重試')
  } finally {
    isUploading.value = false
    emit('uploading', false)
    input.value = ''
  }
}

onBeforeUnmount(() => {
  clearLastObjectUrl()
})
</script>
