<template>
  <div :class="['rm-section-card', flat ? 'admin-area-editor-flat' : 'admin-section-card']">
    <div v-if="showHeader" class="flex items-center justify-between rm-area-editor-top">
      <AdminPanelTitle tag="h3" tight>
        {{ sectionLabel }}（{{ areas.length }} 個）
      </AdminPanelTitle>
    </div>

    <div class="admin-area-editor-stack">
      <div v-if="showCanvas" :ref="setCanvasRef" class="canvas-wrap" :style="canvasStyle">
        <div
          v-for="(area, index) in areas"
          :key="index"
          class="canvas-area"
          :class="{
            'area-active': dragAreaIndex === index,
            'area-overlap': overlapSet.has(index),
          }"
          :style="areaStyle(area, index)"
          @mousedown.prevent="emit('start-drag', $event, index)"
        >
          <span class="area-label">{{ index + 1 }}</span>
          <div class="rh nw" @mousedown.stop.prevent="emit('start-resize', $event, index, 'nw')" />
          <div class="rh n" @mousedown.stop.prevent="emit('start-resize', $event, index, 'n')" />
          <div class="rh ne" @mousedown.stop.prevent="emit('start-resize', $event, index, 'ne')" />
          <div class="rh e" @mousedown.stop.prevent="emit('start-resize', $event, index, 'e')" />
          <div class="rh se" @mousedown.stop.prevent="emit('start-resize', $event, index, 'se')" />
          <div class="rh s" @mousedown.stop.prevent="emit('start-resize', $event, index, 's')" />
          <div class="rh sw" @mousedown.stop.prevent="emit('start-resize', $event, index, 'sw')" />
          <div class="rh w" @mousedown.stop.prevent="emit('start-resize', $event, index, 'w')" />
        </div>

        <div
          v-for="(gl, gi) in guideLines"
          :key="`gl-${gi}`"
          class="guide-line"
          :class="gl.type"
          :style="gl.type === 'v'
            ? { left: `${(gl.pos / baseWidth) * 100}%` }
            : { top: `${(gl.pos / baseHeight) * 100}%` }"
        />
      </div>

      <div v-if="showActionCards" class="admin-action-card-stack carousel-cards-scroll cards-scroll-top-gap">
        <div
          v-for="(area, index) in areas"
          :key="index"
          class="carousel-sub-card rm-area-card admin-action-card"
        >
          <div class="carousel-card-top">
            <div class="flex gap-1 items-center">
              <span
                class="carousel-card-idx rm-area-idx"
                :style="{ background: areaColors[index % areaColors.length], color: '#fff' }"
              >
                {{ index + 1 }}
              </span>
              <span class="carousel-action-index">區塊 {{ index + 1 }}</span>
            </div>
            <div class="admin-card-header-row">
              <el-button
                v-if="allowRemove"
                link
                type="danger"
                size="small"
                :disabled="areas.length <= 1"
                @click="emit('remove', index)"
              >
                ✕
              </el-button>
            </div>
          </div>

          <div class="carousel-sub-body carousel-sub-body-top-gap admin-action-card-body">
            <el-form
              v-if="showBounds"
              label-position="top"
              class="admin-form-nested"
              @submit.prevent
            >
              <div class="admin-action-bounds" aria-label="區塊座標">
                <el-form-item label="X" class="admin-form-item-compact">
                  <el-input-number
                    v-model="area.bounds.x"
                    :min="0"
                    :max="baseWidth"
                    :controls="false"
                    size="small"
                    class="admin-w-full admin-number-input"
                    @change="emit('clamp', index)"
                  />
                </el-form-item>
                <el-form-item label="Y" class="admin-form-item-compact">
                  <el-input-number
                    v-model="area.bounds.y"
                    :min="0"
                    :max="baseHeight"
                    :controls="false"
                    size="small"
                    class="admin-w-full admin-number-input"
                    @change="emit('clamp', index)"
                  />
                </el-form-item>
                <el-form-item label="Width" class="admin-form-item-compact">
                  <el-input-number
                    v-model="area.bounds.width"
                    :min="minBoundsSize"
                    :max="baseWidth"
                    :controls="false"
                    size="small"
                    class="admin-w-full admin-number-input"
                    @change="emit('clamp', index)"
                  />
                </el-form-item>
                <el-form-item label="Height" class="admin-form-item-compact">
                  <el-input-number
                    v-model="area.bounds.height"
                    :min="minBoundsSize"
                    :max="baseHeight"
                    :controls="false"
                    size="small"
                    class="admin-w-full admin-number-input"
                    @change="emit('clamp', index)"
                  />
                </el-form-item>
              </div>
            </el-form>

            <section
              class="admin-action-panel"
              :class="{ 'admin-action-panel--split': showBounds }"
              aria-label="區塊動作"
            >
              <el-form label-position="top" class="admin-form-nested" @submit.prevent>
                <slot name="action-fields" :area="area" :index="index" />
                <slot name="action-error" :area="area" :index="index" />
              </el-form>
            </section>
          </div>
        </div>
        <button
          v-if="showAddButton"
          type="button"
          class="carousel-add-card admin-action-add-card"
          @click="emit('add')"
        >
          <span class="add-card-plus">＋</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  areas: any[]
  sectionLabel: string
  showAddButton: boolean
  allowRemove: boolean
  showBounds: boolean
  showCanvas?: boolean
  showActionCards?: boolean
  showHeader?: boolean
  flat?: boolean
  minBoundsSize: number
  baseWidth: number
  baseHeight: number
  areaColors: string[]
  dragAreaIndex: number | null
  overlapSet: Set<number>
  guideLines: Array<{ type: 'h' | 'v'; pos: number }>
  canvasStyle: Record<string, string>
  setCanvasRef?: (el: HTMLElement | null) => void
}>(), {
  showCanvas: true,
  showActionCards: true,
  showHeader: true,
  flat: false,
})

const emit = defineEmits<{
  (e: 'add'): void
  (e: 'remove', index: number): void
  (e: 'start-drag', event: MouseEvent, index: number): void
  (e: 'start-resize', event: MouseEvent, index: number, handle: string): void
  (e: 'clamp', index: number): void
}>()

function areaStyle(area: any, index: number) {
  const bounds = area?.bounds || { x: 0, y: 0, width: props.baseWidth, height: props.baseHeight }
  return {
    left: `${(Number(bounds.x || 0) / props.baseWidth) * 100}%`,
    top: `${(Number(bounds.y || 0) / props.baseHeight) * 100}%`,
    width: `${(Number(bounds.width || 0) / props.baseWidth) * 100}%`,
    height: `${(Number(bounds.height || 0) / props.baseHeight) * 100}%`,
    background: props.areaColors[index % props.areaColors.length],
  }
}

function setCanvasRef(el: any) {
  props.setCanvasRef?.(el as HTMLElement | null)
}
</script>
