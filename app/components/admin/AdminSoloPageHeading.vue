<template>
  <div class="admin-flex-1">
    <AdminFieldLabel :text="props.fieldLabel" tight />
    <div class="admin-title-row">
      <span class="split-editor-title">{{ props.title }}</span>
    </div>
    <p v-if="props.caption" class="text-sm text-muted admin-subtext">{{ props.caption }}</p>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  fieldLabel: string
  title: string
  caption?: string
}>()
</script>
