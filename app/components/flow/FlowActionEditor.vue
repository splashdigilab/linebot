<template>
  <div :class="['carousel-action-row', { 'carousel-action-row--flat': flat }]">
    <div v-if="headerLabel || $slots['top-extra']" class="carousel-action-row-top">
      <span class="carousel-action-index">{{ headerLabel }}</span>
      <slot name="top-extra" />
    </div>

    <div class="admin-field-group">
      <AdminFieldLabel :text="typeTitle" tight />
      <el-select v-model="action.type" :size="fieldSize" class="control-full">
        <el-option
          v-for="option in typeOptions"
          :key="option.value"
          :value="option.value"
          :label="option.label"
        />
      </el-select>
    </div>

    <template v-if="showLabelField && isActionEnabled">
      <div class="admin-field-group">
        <AdminFieldLabel :text="labelTitle" tight />
        <div :class="['flow-input-inset-wrap', insetWrapClass, 'control-full']">
          <el-input
            v-model="action.label"
            :placeholder="labelPlaceholder"
            :maxlength="labelMaxlength"
            :show-word-limit="labelShowWordLimit"
            :size="fieldSize"
          />
          <FlowVariableInset
            v-if="showVariableInset"
            :size="insetButtonSize"
            :options="variableOptions"
            @pick="(token) => insertToken('label', String(token))"
          />
        </div>
      </div>
    </template>

    <template v-if="action.type === moduleTypeValue">
      <div class="admin-field-group">
        <AdminFieldLabel :text="moduleTitle" tight />
        <el-select
          v-model="action.moduleId"
          :placeholder="modulePlaceholder"
          :size="fieldSize"
          class="control-full"
        >
          <el-option
            v-for="moduleOption in moduleOptions"
            :key="moduleOption.id"
            :value="moduleOption.id"
            :label="moduleOption.name"
          />
        </el-select>
      </div>
    </template>

    <template v-else-if="action.type === uriTypeValue">
      <div class="admin-field-group">
        <AdminFieldLabel :text="uriTitle" tight />
        <el-input v-model="action.uri" :placeholder="uriPlaceholder" :size="fieldSize" />
      </div>
    </template>

    <template v-else-if="action.type === messageTypeValue">
      <div class="admin-field-group">
        <AdminFieldLabel :text="textTitle" tight />
        <div :class="['flow-input-inset-wrap', insetWrapClass, 'control-full']">
          <el-input v-model="action.text" :placeholder="textPlaceholder" :size="fieldSize" />
          <FlowVariableInset
            v-if="showVariableInset"
            :size="insetButtonSize"
            :options="variableOptions"
            @pick="(token) => insertToken('text', String(token))"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
type ActionOption = {
  value: string
  label: string
}

type VariableOption = {
  value: string
  label: string
  token: string
}

type ModuleOption = {
  id: string
  name: string
}

const props = withDefaults(defineProps<{
  action: Record<string, any>
  typeOptions: ActionOption[]
  moduleOptions: ModuleOption[]
  variableOptions: VariableOption[]
  headerLabel?: string
  typeTitle?: string
  showLabelField?: boolean
  labelTitle?: string
  labelPlaceholder?: string
  labelMaxlength?: number
  labelShowWordLimit?: boolean
  textTitle?: string
  textPlaceholder?: string
  uriTitle?: string
  uriPlaceholder?: string
  moduleTitle?: string
  modulePlaceholder?: string
  fieldSize?: 'default' | 'small'
  flat?: boolean
  showVariableInset?: boolean
  hideFieldsWhenNone?: boolean
  noneTypeValue?: string
  messageTypeValue?: string
  uriTypeValue?: string
  moduleTypeValue?: string
}>(), {
  headerLabel: '按鈕動作',
  typeTitle: '動作類型',
  showLabelField: true,
  labelTitle: '按鈕顯示文字（最多 20 字）',
  labelPlaceholder: '按鈕名稱 (必填，限 20 字)',
  labelMaxlength: 20,
  labelShowWordLimit: false,
  textTitle: '回覆文字',
  textPlaceholder: '回覆文字',
  uriTitle: '網址',
  uriPlaceholder: 'https://...',
  moduleTitle: '機器人模組',
  modulePlaceholder: '選擇機器人模組',
  fieldSize: 'default',
  flat: false,
  showVariableInset: true,
  hideFieldsWhenNone: false,
  noneTypeValue: 'none',
  messageTypeValue: 'message',
  uriTypeValue: 'uri',
  moduleTypeValue: 'module',
})

const isActionEnabled = computed(() =>
  !props.hideFieldsWhenNone || props.action.type !== props.noneTypeValue,
)

const insetWrapClass = computed(() =>
  props.fieldSize === 'small' ? 'flow-input-inset-wrap--sm' : '',
)

const insetButtonSize = computed(() =>
  props.fieldSize === 'small' ? 'sm' : 'default',
)

function insertToken(key: 'label' | 'text', token: string) {
  const current = typeof props.action[key] === 'string' ? props.action[key] : ''
  props.action[key] = `${current}${token}`
}
</script>
