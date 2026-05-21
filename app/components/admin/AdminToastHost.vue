<template>
  <AdminToastStack :toasts="toasts" />
</template>

<script setup lang="ts">
const { toasts } = useAdminToast()
</script>
