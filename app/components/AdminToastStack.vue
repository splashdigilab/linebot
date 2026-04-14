<template>
  <div class="toast-bar">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">
      <span>{{ t.type === 'success' ? '✅' : '❌' }}</span>
      <span>{{ t.msg }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
interface AdminToastItem {
  id: number
  msg: string
  type: 'success' | 'error'
}

defineProps<{
  toasts: AdminToastItem[]
}>()
</script>
