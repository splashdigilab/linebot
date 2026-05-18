<template>
  <slot v-if="canOperate" />
</template>

<script setup lang="ts">
const { canOperate } = useWorkspace()
</script>
