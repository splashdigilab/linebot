<template>
  <component
    :is="props.tag"
    :class="[
      'admin-panel-title',
      { 'admin-panel-title--tight': props.tight },
    ]"
  >
    <slot>{{ props.text }}</slot>
  </component>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  text?: string
  tag?: 'h2' | 'h3' | 'p' | 'div' | 'span'
  tight?: boolean
}>(), {
  text: '',
  tag: 'h3',
  tight: false,
})
</script>
