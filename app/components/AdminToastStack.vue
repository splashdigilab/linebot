<template>
  <div class="toast-bar">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">
      <span class="toast__icon"><el-icon><component :is="t.type === 'success' ? CircleCheckFilled : t.type === 'warning' ? WarningFilled : CircleCloseFilled" /></el-icon></span>
      <span>{{ t.msg }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CircleCheckFilled, CircleCloseFilled, WarningFilled } from '@element-plus/icons-vue'
interface AdminToastItem {
  id: number
  msg: string
  type: 'success' | 'error' | 'warning'
}

defineProps<{
  toasts: AdminToastItem[]
}>()
</script>
