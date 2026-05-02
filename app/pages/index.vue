<script setup lang="ts">
// Redirect root to workspace 選擇（auth middleware 未登入會導向 /login）
await navigateTo('/admin/workspaces', { replace: true })
</script>

<template>
  <div></div>
</template>
