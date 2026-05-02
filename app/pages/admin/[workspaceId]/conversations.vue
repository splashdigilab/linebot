<template>
  <ConversationsAdminPanel :api-fetch="apiFetch" />
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'default' })

const { apiFetch } = useWorkspace()
</script>
