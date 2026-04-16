<template>
  <div :class="wrapperClass">
    <AdminPanelTitle tag="h3" :text="title" />
    <div class="admin-layout-row">
      <button
        v-for="layout in layouts"
        :key="layout.id"
        type="button"
        class="admin-layout-item"
        :class="{ active: selectedId === layout.id }"
        @click="emit('select', layout.id)"
      >
        <span class="admin-layout-name">{{ layout.label }}</span>
        <span class="admin-layout-preview" :class="`preview-${layout.id}`">
          <span
            v-for="cell in layout.cells"
            :key="cell"
            class="admin-layout-cell"
          />
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
type LayoutOption = {
  id: string
  label: string
  cells: number
}

const props = withDefaults(defineProps<{
  title?: string
  layouts: LayoutOption[]
  selectedId: string
  flat?: boolean
}>(), {
  title: '圖文樣式',
  flat: false,
})

const emit = defineEmits<{
  (e: 'select', layoutId: string): void
}>()

const wrapperClass = computed(() => (
  props.flat
    ? 'admin-layout-picker admin-layout-picker--flat'
    : 'admin-layout-picker admin-section-card rm-section-card'
))
</script>
