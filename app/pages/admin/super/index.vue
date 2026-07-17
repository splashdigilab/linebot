<template>
  <div />
</template>

<script setup lang="ts">
// Super Admin 首頁沒有內容 → 用重導向 middleware 直接送到組織列表，避免落在空白頁（且不會先閃一下空畫面）
definePageMeta({
  middleware: ['auth', 'super-admin', () => navigateTo('/admin/super/organizations', { replace: true })],
  layout: 'super-admin',
})
</script>
