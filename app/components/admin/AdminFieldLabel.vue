<template>
  <component
    :is="props.tag"
    :class="[
      'admin-field-label',
      {
        'admin-field-label--tight': props.tight,
      },
    ]"
  >
    <slot>{{ props.text }}</slot>
  </component>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  text?: string
  tag?: 'p' | 'div' | 'span' | 'label'
  tight?: boolean
}>(), {
  text: '',
  tag: 'p',
  tight: false,
})
</script>
