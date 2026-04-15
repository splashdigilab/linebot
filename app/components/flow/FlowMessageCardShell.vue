<template>
  <div class="message-card">
    <div class="message-card-header">
      <div class="card-header-main">
        <slot name="drag-handle">
          <span class="drag-handle" draggable="true">⠿</span>
        </slot>
        <span class="badge" :class="badgeClass">{{ badgeLabel }}</span>
      </div>
      <el-button
        v-if="showRemove"
        link
        type="danger"
        class="card-remove-btn"
        @click="$emit('remove')"
      >
        ✕
      </el-button>
    </div>
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    badgeLabel: string
    badgeClass?: string
    showRemove?: boolean
  }>(),
  {
    badgeClass: 'badge-gray',
    showRemove: true,
  },
)

defineEmits<{
  remove: []
}>()
</script>
