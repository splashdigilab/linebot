<template>
  <div class="carousel-actions">
    <div class="carousel-action-row">
      <div class="carousel-action-row-top">
        <span class="carousel-action-index">區塊動作</span>
      </div>

      <div class="admin-field-group">
        <AdminFieldLabel text="動作類型" tight />
        <el-select
          v-model="action.type"
          class="admin-w-full control-full"
          :disabled="disabled"
          @change="onTypeChange"
        >
          <el-option value="uri" label="開啟網址" />
          <el-option value="message" label="傳送文字" />
          <el-option value="module" label="觸發機器人模組" />
          <el-option v-if="allowSwitch" value="switch" label="切換選單" />
        </el-select>
      </div>

      <template v-if="action.type === 'uri'">
        <div class="admin-field-group">
          <AdminFieldLabel text="網址" tight />
          <el-input v-model="action.uri" placeholder="https://..." :disabled="disabled" />
        </div>
      </template>

      <template v-if="action.type === 'message'">
        <div class="admin-field-group">
          <AdminFieldLabel text="回覆文字" tight />
          <el-input v-model="action.text" placeholder="輸入代發文字" :disabled="disabled" />
        </div>
      </template>

      <template v-if="action.type === 'module'">
        <div class="admin-field-group">
          <AdminFieldLabel :text="moduleLabel" tight />
          <el-select
            v-model="action.moduleId"
            class="admin-w-full control-full"
            :placeholder="modulePlaceholder"
            :disabled="disabled"
          >
            <el-option
              v-for="mod in moduleOptions"
              :key="mod.id"
              :value="mod.id"
              :label="mod.name"
            />
          </el-select>
        </div>
      </template>

      <template v-if="allowSwitch && action.type === 'switch'">
        <div class="admin-field-group">
          <AdminFieldLabel :text="switchLabel" tight />
          <el-select
            v-model="action.data"
            class="admin-w-full control-full"
            :placeholder="switchPlaceholder"
            :disabled="disabled"
          >
            <el-option
              v-for="menu in availableMenuOptions"
              :key="menu.id"
              :value="`${menuValuePrefix}${menu.id}`"
              :label="menu.name"
            />
          </el-select>
        </div>
      </template>

      <template v-if="enableTagging">
        <div class="admin-field-group">
          <AdminFieldLabel text="啟用貼標" tight />
          <el-switch
            v-model="ensureTaggingState().enabled"
            active-text="啟用"
            inactive-text="停用"
            class="ar-status-switch"
            :disabled="disabled || !isTaggableAction"
          />
        </div>
        <div v-if="!isTaggableAction" class="text-xs text-muted">
          此動作類型目前不支援貼標。
        </div>
        <div v-if="ensureTaggingState().enabled" class="admin-field-group">
          <el-select
            v-model="ensureTaggingState().addTagIds"
            class="admin-w-full control-full"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="選擇要貼的標籤"
            :disabled="disabled || !isTaggableAction"
          >
            <el-option
              v-for="tag in tagOptions"
              :key="tag.id"
              :value="tag.id"
              :label="tag.name"
            >
              <AdminTagOptionRow :label="tag.name" :color="tag.color" />
            </el-option>
          </el-select>
        </div>
      </template>

    </div>
  </div>
</template>

<script setup lang="ts">
type EditorOption = { id: string; name: string }
type TagOption = { id: string; name: string; color?: string }

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
  tagOptions?: TagOption[]
  taggableActionTypes?: string[]
  menuOptions?: EditorOption[]
  allowSwitch?: boolean
  enableTagging?: boolean
  excludeMenuId?: string | null
  menuValuePrefix?: string
  moduleLabel?: string
  modulePlaceholder?: string
  switchLabel?: string
  switchPlaceholder?: string
  errorMessage?: string
  /** 唯讀（例如已發送推播僅檢視） */
  disabled?: boolean
}>(), {
  tagOptions: () => [],
  taggableActionTypes: () => ['module', 'message', 'uri'],
  menuOptions: () => [],
  allowSwitch: false,
  enableTagging: false,
  excludeMenuId: null,
  menuValuePrefix: 'switchMenu=',
  moduleLabel: '選擇目標模組',
  modulePlaceholder: '請選擇要觸發的機器人模組...',
  switchLabel: '選擇目標圖文選單',
  switchPlaceholder: '請選擇要切換的選單...',
  errorMessage: '',
  disabled: false,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: ActionShape): void
}>()

const action = computed(() => props.modelValue)

const availableMenuOptions = computed(() =>
  (props.menuOptions || []).filter((menu) => menu.id !== props.excludeMenuId)
)

const isTaggableAction = computed(() =>
  Array.isArray(props.taggableActionTypes)
  && props.taggableActionTypes.includes(String(action.value?.type || '')),
)

function onTypeChange() {
  if (props.disabled) return
  const nextType = action.value?.type || 'uri'
  emit('update:modelValue', {
    ...action.value,
    type: nextType,
    uri: '',
    text: '',
    moduleId: '',
    data: '',
    tagging: { enabled: false, addTagIds: [] },
  })
}

function ensureTaggingState() {
  if (!action.value.tagging || typeof action.value.tagging !== 'object') {
    action.value.tagging = { enabled: false, addTagIds: [] }
  }
  if (!Array.isArray(action.value.tagging.addTagIds)) {
    action.value.tagging.addTagIds = []
  }
  return action.value.tagging as { enabled: boolean; addTagIds: string[] }
}

watch(isTaggableAction, (supported) => {
  if (!supported) {
    const tagging = ensureTaggingState()
    tagging.enabled = false
    tagging.addTagIds = []
  }
}, { immediate: true })
</script>
