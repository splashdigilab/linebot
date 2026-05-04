<template>
  <button
    type="button"
    class="split-list-item"
    :class="{ active: props.active, 'has-leading-avatar': showLeadingBlock }"
    @click="emit('select')"
  >
    <span
      v-if="showLeadingBlock"
      class="split-list-item__avatar-wrap"
      :class="{ 'is-unread': props.showUnreadDot }"
    >
      <img
        v-if="trimmedAvatarUrl"
        :src="trimmedAvatarUrl"
        class="split-list-item__avatar"
        alt=""
      />
      <span
        v-else
        class="split-list-item__avatar split-list-item__avatar--placeholder"
        aria-hidden="true"
      >👤</span>
    </span>
    <div class="split-list-item__main">
      <template v-if="props.timeInTitleRow && !$slots.meta">
        <div class="split-list-item__title-row">
          <div class="split-list-name">{{ props.title }}</div>
          <span
            v-if="trimmedChipText && props.titleRowChip"
            class="split-list-chip split-list-chip--in-title-row"
            :class="`is-${props.chipTone}`"
          >{{ trimmedChipText }}</span>
          <span
            v-else-if="trimmedChipText"
            class="split-list-item__time"
          >{{ trimmedChipText }}</span>
        </div>
        <div v-if="trimmedMetaText" class="split-list-meta split-list-meta--stacked">
          <span
            class="split-list-meta-text"
            :class="{ truncate: props.metaTruncate }"
          >{{ props.metaText }}</span>
        </div>
      </template>
      <template v-else>
        <div class="split-list-name">{{ props.title }}</div>
        <div v-if="$slots.meta || props.chipText || props.metaText" class="split-list-meta">
          <slot v-if="$slots.meta" name="meta" />
          <template v-else>
            <span
              v-if="props.chipText"
              class="split-list-chip"
              :class="`is-${props.chipTone}`"
            >
              {{ props.chipText }}
            </span>
            <span
              v-if="props.metaText"
              class="split-list-meta-text"
              :class="{ truncate: props.metaTruncate }"
            >
              {{ props.metaText }}
            </span>
          </template>
        </div>
      </template>
    </div>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  title: string
  active?: boolean
  chipText?: string
  chipTone?: 'success' | 'neutral' | 'warning' | 'error'
  metaText?: string
  metaTruncate?: boolean
  /** 左側頭貼 URL；與 showLeadingAvatarFallback 擇一或併用 */
  leadingAvatarUrl?: string
  /** 無頭貼 URL 時仍顯示佔位符（對話列表用） */
  showLeadingAvatarFallback?: boolean
  /** 使用者有新進線訊息等情境的視覺提示 */
  showUnreadDot?: boolean
  /**
   * 第一行：標題 + 右側時間（純文字）；第二行：摘要。
   * 用於對話列表等類聊天 App 的排版。
   */
  timeInTitleRow?: boolean
  /**
   * 搭配 timeInTitleRow：右側改為狀態膠囊（.split-list-chip），位置同對話列表時間。
   * 對話列表請維持 false（右側為時間純文字）。
   */
  titleRowChip?: boolean
}>(), {
  active: false,
  chipText: '',
  chipTone: 'neutral',
  metaText: '',
  metaTruncate: false,
  leadingAvatarUrl: '',
  showLeadingAvatarFallback: false,
  showUnreadDot: false,
  timeInTitleRow: false,
  titleRowChip: false,
})

const emit = defineEmits<{
  (e: 'select'): void
}>()

const trimmedAvatarUrl = computed(() => String(props.leadingAvatarUrl || '').trim())
const trimmedChipText = computed(() => String(props.chipText || '').trim())
const trimmedMetaText = computed(() => String(props.metaText || '').trim())

const showLeadingBlock = computed(() =>
  Boolean(trimmedAvatarUrl.value) || props.showLeadingAvatarFallback,
)
</script>
