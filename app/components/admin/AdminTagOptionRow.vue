<template>
  <span class="tags-option-row">
    <span class="tag-color-dot" :style="{ '--dot-bg': color }" />
    <span class="tags-option-row__label">{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
const props = defineProps<{
  label: string
  color?: string
}>()

const color = computed(() => props.color || '#6B7280')
</script>
