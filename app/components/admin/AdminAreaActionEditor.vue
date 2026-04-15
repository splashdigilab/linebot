<template>
  <div class="carousel-actions">
    <div class="carousel-action-row">
      <div class="carousel-action-row-top">
        <span class="carousel-action-index">區塊動作</span>
      </div>

      <p class="fuz-section-label section-label-tight">動作類型</p>
      <el-select
        v-model="action.type"
        class="admin-w-full control-full"
        @change="onTypeChange"
      >
        <el-option value="uri" label="開啟網址" />
        <el-option value="message" label="傳送文字" />
        <el-option value="module" label="觸發機器人模組" />
        <el-option v-if="allowSwitch" value="switch" label="切換選單" />
      </el-select>

      <template v-if="action.type === 'uri'">
        <p class="fuz-section-label section-label-tight">網址</p>
        <el-input v-model="action.uri" placeholder="https://..." />
      </template>

      <template v-if="action.type === 'message'">
        <p class="fuz-section-label section-label-tight">回覆文字</p>
        <el-input v-model="action.text" placeholder="輸入代發文字" />
      </template>

      <template v-if="action.type === 'module'">
        <p class="fuz-section-label section-label-tight">{{ moduleLabel }}</p>
        <el-select
          v-model="action.moduleId"
          class="admin-w-full control-full"
          :placeholder="modulePlaceholder"
        >
          <el-option
            v-for="mod in moduleOptions"
            :key="mod.id"
            :value="mod.id"
            :label="mod.name"
          />
        </el-select>
      </template>

      <template v-if="allowSwitch && action.type === 'switch'">
        <p class="fuz-section-label section-label-tight">{{ switchLabel }}</p>
        <el-select
          v-model="action.data"
          class="admin-w-full control-full"
          :placeholder="switchPlaceholder"
        >
          <el-option
            v-for="menu in availableMenuOptions"
            :key="menu.id"
            :value="`${menuValuePrefix}${menu.id}`"
            :label="menu.name"
          />
        </el-select>
        <div
          v-if="action.data && hasInvalidSwitchTarget"
          class="admin-warning-inline"
        >
          ⚠️ 所選的目標選單已不存在，請重新選擇
        </div>
      </template>

      <div v-if="errorMessage" class="admin-warning-inline">
        {{ errorMessage }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
type EditorOption = { id: string; name: string }

type ActionShape = {
  type?: string
  uri?: string
  text?: string
  moduleId?: string
  data?: string
  [key: string]: any
}

const props = withDefaults(defineProps<{
  modelValue: ActionShape
  moduleOptions: EditorOption[]
  menuOptions?: EditorOption[]
  allowSwitch?: boolean
  excludeMenuId?: string | null
  menuValuePrefix?: string
  moduleLabel?: string
  modulePlaceholder?: string
  switchLabel?: string
  switchPlaceholder?: string
  errorMessage?: string
}>(), {
  menuOptions: () => [],
  allowSwitch: false,
  excludeMenuId: null,
  menuValuePrefix: 'switchMenu=',
  moduleLabel: '選擇目標模組',
  modulePlaceholder: '請選擇要觸發的機器人模組...',
  switchLabel: '選擇目標 Rich Menu',
  switchPlaceholder: '請選擇要切換的選單...',
  errorMessage: '',
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: ActionShape): void
}>()

const action = computed(() => props.modelValue)

const availableMenuOptions = computed(() =>
  (props.menuOptions || []).filter((menu) => menu.id !== props.excludeMenuId)
)

const hasInvalidSwitchTarget = computed(() => {
  const current = String(action.value?.data || '')
  if (!current) return false
  return !availableMenuOptions.value.some((menu) => `${props.menuValuePrefix}${menu.id}` === current)
})

function onTypeChange() {
  const nextType = action.value?.type || 'uri'
  emit('update:modelValue', {
    ...action.value,
    type: nextType,
    uri: '',
    text: '',
    moduleId: '',
    data: '',
  })
}
</script>
