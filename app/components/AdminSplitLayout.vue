<template>
  <div class="split-layout">
    <!-- ── Left Sidebar ─────────────────────────────── -->
    <aside class="split-sidebar">
      <div class="split-sidebar-header">
        <slot name="sidebar-header" />
      </div>

      <!-- Scrollable list container -->
      <div class="split-list-container">
        <slot name="sidebar-list" />
      </div>
    </aside>

    <!-- ── Right Editor ───────────────────────────── -->
    <main class="split-editor">
      <div v-if="isEmpty" class="split-empty-state">
        <slot name="editor-empty" />
      </div>

      <div v-else class="split-editor-inner">
        <!-- Editor Header -->
        <div class="split-editor-header">
          <slot name="editor-header" />
        </div>

        <!-- Editor Body -->
        <div class="split-editor-body">
          <slot name="editor-body" />
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
defineProps({
  isEmpty: {
    type: Boolean,
    default: false,
  },
})
</script>
