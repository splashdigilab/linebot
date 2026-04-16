<template>
  <div class="admin-flex-1">
    <AdminFieldLabel :text="props.fieldLabel" tight />
    <div class="admin-title-row">
      <span v-if="props.isCreating" class="split-editor-title">{{ props.createPrefix }}</span>
      <el-input
        :model-value="props.modelValue"
        size="large"
        class="admin-title-input"
        :placeholder="props.placeholder"
        @update:model-value="onInput"
        @keydown.enter.prevent="emit('enter')"
      />
    </div>
    <p class="text-sm text-muted admin-subtext">{{ props.caption }}</p>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  fieldLabel: string
  placeholder: string
  caption: string
  createPrefix: string
  isCreating: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'enter'): void
}>()

function onInput(value: string | number) {
  emit('update:modelValue', String(value ?? ''))
}
</script>
