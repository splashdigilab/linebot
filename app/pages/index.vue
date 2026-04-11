<script setup lang="ts">
// Redirect root to /admin (auth middleware will redirect to /login if not authenticated)
await navigateTo('/admin', { replace: true })
</script>

<template>
  <div></div>
</template>
