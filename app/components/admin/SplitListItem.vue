<template>
  <button
    type="button"
    class="split-list-item"
    :class="{ active: props.active }"
    @click="emit('select')"
  >
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
  </button>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  title: string
  active?: boolean
  chipText?: string
  chipTone?: 'success' | 'neutral'
  metaText?: string
  metaTruncate?: boolean
}>(), {
  active: false,
  chipText: '',
  chipTone: 'neutral',
  metaText: '',
  metaTruncate: false,
})

const emit = defineEmits<{
  (e: 'select'): void
}>()
</script>
