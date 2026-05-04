<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'default' })

const route = useRoute()
const wid = route.params.workspaceId as string

await navigateTo(`/admin/${wid}/conversation-stats`, { replace: true })
</script>

<template>
  <div />
</template>
