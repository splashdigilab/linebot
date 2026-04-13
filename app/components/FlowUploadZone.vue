<template>
  <div>
    <!-- Preview state -->
    <div v-if="modelValue" class="fuz-preview" :style="previewStyle">
      <img v-if="type === 'image'" :src="modelValue" alt="preview" class="fuz-preview-img" />
      <video v-else-if="type === 'video'" :src="modelValue" class="fuz-preview-img" controls />
      <div class="fuz-preview-overlay">
        <el-button type="danger" size="small" @click="$emit('update:modelValue', '')">
          更換{{ type === 'video' ? '影片' : '圖片' }}
        </el-button>
      </div>
    </div>

    <!-- Upload zone -->
    <div v-else class="upload-zone fuz-zone" :class="{ uploading: isUploading }" @click="triggerPick">
      <div v-if="isUploading" class="fuz-uploading">
        <div class="spinner" style="margin: 0 auto 0.5rem;" />
        <span>上傳中...</span>
      </div>
      <div v-else class="fuz-idle">
        <span class="fuz-icon">{{ type === 'video' ? '🎬' : '📷' }}</span>
        <span class="fuz-label">{{ label }}</span>
        <span v-if="hint" class="fuz-hint">{{ hint }}</span>
      </div>
    </div>

    <!-- Hidden file input -->
    <input
      ref="inputRef"
      type="file"
      :accept="acceptAttr"
      style="display: none"
      @change="onFileChange"
    />
  </div>
</template>

<script setup lang="ts">
import {
  IMAGE_ACCEPT_ATTR,
  IMAGE_MAX_BYTES,
  IMAGE_MIME_TYPES,
  VIDEO_ACCEPT_ATTR,
  VIDEO_MAX_BYTES,
  VIDEO_MIME_TYPES,
} from '../../shared/upload-rules'

const props = defineProps<{
  modelValue: string
  type?: 'image' | 'video'
  label?: string
  hint?: string
  previewHeight?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void
  (e: 'uploading', val: boolean): void
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const isUploading = ref(false)

const acceptAttr = computed(() =>
  props.type === 'video'
    ? VIDEO_ACCEPT_ATTR
    : IMAGE_ACCEPT_ATTR
)

const previewStyle = computed(() => ({
  height: props.previewHeight ?? '180px',
}))

function triggerPick() {
  inputRef.value?.click()
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const isVideo = props.type === 'video'
  const allowTypes = isVideo ? VIDEO_MIME_TYPES : IMAGE_MIME_TYPES
  const maxBytes = isVideo ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES

  if (!allowTypes.includes(file.type)) {
    alert(isVideo ? '僅支援 MP4 格式' : '僅支援 JPG / PNG 格式')
    input.value = ''
    return
  }

  if (file.size > maxBytes) {
    alert(isVideo ? '影片不能超過 5MB' : '圖片不能超過 500KB')
    input.value = ''
    return
  }

  isUploading.value = true
  emit('uploading', true)

  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    const res = await $fetch<{ imageUrl: string }>('/api/upload', {
      method: 'POST',
      body: { imageBase64: base64, contentType: file.type },
    })

    emit('update:modelValue', res.imageUrl)
  } catch {
    alert('上傳失敗，請重試')
  } finally {
    isUploading.value = false
    emit('uploading', false)
    input.value = ''
  }
}
</script>

<style scoped>
.fuz-zone {
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
  cursor: pointer;
}

.fuz-uploading,
.fuz-idle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  text-align: center;
}

.fuz-icon {
  font-size: 1.8rem;
  display: block;
}

.fuz-label {
  font-size: 0.875rem;
  color: var(--text-muted);
  font-weight: 500;
}

.fuz-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
  opacity: 0.7;
}

/* Preview */
.fuz-preview {
  position: relative;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: #000;
}

.fuz-preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.fuz-preview-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}

.fuz-preview:hover .fuz-preview-overlay {
  opacity: 1;
}
</style>
