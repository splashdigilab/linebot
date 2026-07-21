<template>
  <div class="flow-var-inset" @click.stop>
    <el-dropdown trigger="click" placement="bottom-end" teleported @command="onCommand">
      <button
        type="button"
        :class="['flow-var-inset__btn', { 'flow-var-inset__btn--sm': size === 'sm' }]"
        :aria-label="ariaLabel"
        :title="hint"
      >
        {{ glyph }}
      </button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item
            v-for="opt in options"
            :key="opt.value"
            :command="opt.token"
          >
            {{ opt.label }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup lang="ts">
export type VariableInsetOption = { value: string; label: string; token: string }

withDefaults(
  defineProps<{
    options: VariableInsetOption[]
    /** Compact trigger for size="small" inputs */
    size?: 'default' | 'sm'
  }>(),
  { size: 'default' },
)

const emit = defineEmits<{
  pick: [token: string]
}>()

const glyph = '{{...}}'
const ariaLabel = '\u63d2\u5165\u8b8a\u6578'
// \u6ed1\u9f20\u61f8\u505c\u8aaa\u660e\uff08\u767d\u8a71\uff09\uff0c\u907f\u514d {{...}} \u9019\u500b\u5de5\u7a0b\u7b26\u865f\u6c92\u4eba\u770b\u5f97\u61c2
const hint = '\u63d2\u5165\u8b8a\u6578\uff08\u4f8b\uff1a\u806f\u7d61\u4eba\u540d\u7a31\uff09'

function onCommand(cmd: string | number | object) {
  emit('pick', String(cmd))
}
</script>
