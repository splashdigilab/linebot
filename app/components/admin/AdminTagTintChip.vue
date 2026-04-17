<template>
  <span class="tag-chip tag-chip--tinted" :style="{ '--tag-accent': accent }">
    <slot />
  </span>
</template>

<script setup lang="ts">
const props = defineProps<{
  color?: string
}>()

const accent = computed(() => props.color || '#6B7280')
</script>
