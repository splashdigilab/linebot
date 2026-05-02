<template>
  <button
    type="button"
    class="split-list-item"
    :class="{ active: props.active, 'has-leading-avatar': showLeadingBlock }"
    @click="emit('select')"
  >
    <template v-if="showLeadingBlock">
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
    </template>
    <div class="split-list-item__main">
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
}>(), {
  active: false,
  chipText: '',
  chipTone: 'neutral',
  metaText: '',
  metaTruncate: false,
  leadingAvatarUrl: '',
  showLeadingAvatarFallback: false,
})

const emit = defineEmits<{
  (e: 'select'): void
}>()

const trimmedAvatarUrl = computed(() => String(props.leadingAvatarUrl || '').trim())

const showLeadingBlock = computed(() =>
  Boolean(trimmedAvatarUrl.value) || props.showLeadingAvatarFallback,
)
</script>
