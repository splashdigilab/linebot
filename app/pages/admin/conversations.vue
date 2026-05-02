<template>
  <ConversationsAdminPanel :api-fetch="apiFetch" />
</template>

<script setup lang="ts">
import { DEFAULT_LINE_WORKSPACE_ID } from '~~/shared/line-workspace'

definePageMeta({ middleware: 'auth', layout: 'default' })

/** 舊網址 `/admin/conversations`：固定使用 default workspace（與 LINE webhook 一致）。 */
const { apiFetch } = useWorkspaceApiFetch(DEFAULT_LINE_WORKSPACE_ID)
</script>
