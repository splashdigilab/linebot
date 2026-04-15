<template>
  <div class="flow-var-inset" @click.stop>
    <el-dropdown trigger="click" placement="bottom-end" teleported @command="onCommand">
      <button
        type="button"
        :class="['flow-var-inset__btn', { 'flow-var-inset__btn--sm': size === 'sm' }]"
        :aria-label="ariaLabel"
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

function onCommand(cmd: string | number | object) {
  emit('pick', String(cmd))
}
</script>
