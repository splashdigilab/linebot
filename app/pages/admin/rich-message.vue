<template>
  <AdminSplitLayout :is-empty="!selectedItem && !isCreating">
    <template #sidebar-header>
      <span class="split-sidebar-title">📰 圖文訊息</span>
      <el-button type="primary" size="small" @click="openCreate">➕ 新增</el-button>
    </template>

    <template #sidebar-list>
      <div v-if="loading" class="split-sidebar-loading">
        <div class="spinner" />
      </div>
      <div v-else-if="!items.length" class="split-sidebar-empty">
        <span>尚無圖文訊息</span>
        <el-button size="small" type="primary" plain @click="openCreate">立即建立</el-button>
      </div>
      <div v-else class="split-list">
        <AdminSplitListItem
          v-for="item in items"
          :key="item.id"
          :title="item.name"
          :active="selectedId === item.id"
          :meta-text="`${layoutLabel(item.layoutId)} · ${item.actions?.length ?? 0} 個區塊`"
          @select="selectItem(item)"
        />
      </div>
    </template>

    <template #editor-empty>
      <span class="empty-icon">📰</span>
      <h3>選擇一個圖文訊息開始編輯</h3>
      <p>或點擊左側「➕ 新增」建立新的圖文訊息</p>
      <el-button type="primary" @click="openCreate">建立圖文訊息</el-button>
    </template>

    <template #editor-header>
      <AdminEditorHeaderTitle
        v-model="form.name"
        field-label="圖文訊息名稱"
        create-prefix="新增圖文訊息:"
        placeholder="請輸入圖文訊息名稱..."
        caption="選擇後可在機器人模組中直接引用"
        :is-creating="isCreating"
      />
      <div class="flex gap-1 admin-header-actions">
        <el-button v-if="!isCreating && selectedItem" type="danger" @click="deleteItem">🗑️ 刪除</el-button>
        <el-button @click="cancelEdit">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">
          {{ isCreating ? '建立圖文訊息' : '儲存變更' }}
        </el-button>
      </div>
    </template>

    <template #editor-body>
      <el-form label-position="top" class="admin-form-vertical" @submit.prevent>
        <div class="rmsg-editor admin-panel-stack">

          <div class="message-card rmsg-config-card">
            <div class="message-card-header">
              <div class="card-header-main">
                <span class="badge badge-green">📰 圖文訊息設定</span>
              </div>
            </div>
            <div class="card-section-stack">
              <div class="admin-field-group">
                <AdminFieldLabel text="背景圖片" tight />
                <FlowUploadZone
                  v-model="form.heroImageUrl"
                  type="image"
                  appearance="simple"
                  :hint="imageUploadHint"
                />
              </div>

              <div class="admin-field-group">
                <AdminFieldLabel text="保留 PNG 透明區域" tight />
                <div class="admin-inline-control rmsg-toggle-row">
                  <el-switch v-model="form.transparentBackground" />
                  <span>開啟後保留透明像素</span>
                </div>
              </div>

              <div class="admin-field-group">
                <AdminFieldLabel text="聊天列表預覽文字（Alt Text，最多 400 字）" tight />
                <el-input
                  v-model="form.altText"
                  placeholder="必填，最多 400 字"
                  maxlength="400"
                />
              </div>

              <AdminLayoutPresetPicker
                flat
                title="圖文樣式"
                :layouts="LAYOUT_PRESETS"
                :selected-id="form.layoutId"
                @select="onSelectRichMessageLayout"
              />
            </div>
          </div>

          <template v-if="form.heroImageUrl">
            <!-- 區塊設定（上傳圖片後才顯示） -->
            <AdminAreaEditorSection
              :areas="form.actions"
              section-label="區塊設定"
              :show-add-button="isCustomLayout"
              :allow-remove="isCustomLayout"
              :show-bounds="isCustomLayout"
              :min-bounds-size="RICH_MESSAGE_MIN_BOUNDS"
              :base-width="RICH_MESSAGE_CANVAS_SIZE"
              :base-height="RICH_MESSAGE_CANVAS_SIZE"
              :area-colors="areaColors"
              :drag-area-index="areaDragState?.areaIndex ?? null"
              :overlap-set="customOverlapSet"
              :guide-lines="areaGuideLines"
              :canvas-style="richMessageCanvasStyle"
              :set-canvas-ref="setRichMessageCanvasRef"
              @add="addCustomArea"
              @remove="removeCustomArea"
              @start-drag="startCustomDrag"
              @start-resize="startCustomResize"
              @clamp="clampCustomArea"
            >
              <template #action-fields="{ area }">
                <AdminAreaActionEditor
                  :model-value="area"
                  :module-options="flows"
                  :error-message="actionError(area) || ''"
                  @update:model-value="(next) => Object.assign(area, next)"
                />
              </template>
            </AdminAreaEditorSection>
          </template>
        </div>
      </el-form>
    </template>
  </AdminSplitLayout>

  <AdminToastStack :toasts="toasts" />
</template>

<script setup lang="ts">
import {
  IMAGE_MAX_BYTES,
} from '~~/shared/upload-rules'
import {
  SLOT_LABELS as ACTION_SLOT_LABELS,
  validateUnifiedAction,
} from '~~/shared/action-schema'
import {
  RICH_LAYOUT_PRESETS,
  type RichLayoutId,
} from '~~/shared/rich-layout-presets'
import {
  RICH_MESSAGE_CANVAS_SIZE,
  RICH_MESSAGE_MIN_BOUNDS,
  normalizeRichMessageActions,
  newRichMessageAction,
  createRichMessageActions,
  serializeRichMessageActionsForApi,
  clampRichMessageBounds,
  defaultBoundsByIndex,
  presetBoundsToCanvas,
  type RichMessageEditorAction,
} from '~~/shared/rich-message-editor-helpers'

definePageMeta({ middleware: 'auth', layout: 'default' })

type RichMessageAction = RichMessageEditorAction

const LAYOUT_PRESETS = RICH_LAYOUT_PRESETS

const areaColors = [
  'rgba(6,199,85,0.6)',
  'rgba(59,130,246,0.6)',
  'rgba(245,158,11,0.6)',
  'rgba(239,68,68,0.6)',
  'rgba(168,85,247,0.6)',
  'rgba(236,72,153,0.6)',
]

const items = ref<any[]>([])
const flows = ref<any[]>([])
const loading = ref(true)
const saving = ref(false)
const selectedId = ref<string | null>(null)
const isCreating = ref(false)
const { toasts, showToast } = useAdminToast()
const imageMaxKb = Math.floor(IMAGE_MAX_BYTES / 1024)
const imageUploadHint = `JPG / PNG · 最大 ${imageMaxKb}KB（建議 1040x1040）`
const customCanvasRef = ref<HTMLElement | null>(null)
const customAreas = computed(() => form.value.actions as RichMessageAction[])
const originalFormString = ref('')

const isCustomLayout = computed(() => form.value.layoutId === 'custom')

function layoutLabel(layoutId: string) {
  return LAYOUT_PRESETS.find((item) => item.id === layoutId)?.label || '自訂區域'
}

const defaultForm = () => ({
  name: '',
  layoutId: 'custom' as RichLayoutId,
  transparentBackground: false,
  altText: '',
  heroImageUrl: '',
  actions: createRichMessageActions('custom'),
})
const form = ref(defaultForm())

const {
  dragState: areaDragState,
  guideLines: areaGuideLines,
  overlapSet: customOverlapSet,
  clampAllAreas,
  startDrag: startAreaDrag,
  startResize: startAreaResize,
  bindWindowListeners: bindAreaWindowListeners,
  unbindWindowListeners: unbindAreaWindowListeners,
} = useAreaEditor<RichMessageAction>({
  areas: customAreas,
  canvasRef: customCanvasRef,
  canvasWidth: () => RICH_MESSAGE_CANVAS_SIZE,
  canvasHeight: () => RICH_MESSAGE_CANVAS_SIZE,
  minSize: RICH_MESSAGE_MIN_BOUNDS,
  snapPx: 8,
  enableSnap: true,
  getBounds: (action) => action.bounds ?? defaultBoundsByIndex(0),
  setBounds: (action, bounds) => {
    action.bounds = bounds
  },
})

const richMessageCanvasStyle = computed(() => {
  const url = form.value.heroImageUrl
  const d = areaDragState.value
  return {
    paddingBottom: '100%',
    ...(url ? { backgroundImage: `url(${url})` } : {}),
    cursor: d?.type === 'move' ? 'grabbing' : 'default',
    userSelect: d ? 'none' : 'auto',
  }
})

function setRichMessageCanvasRef(el: HTMLElement | null) {
  customCanvasRef.value = el
}

const selectedItem = computed(() => items.value.find(item => item.id === selectedId.value) ?? null)

function serializeFormState() {
  return JSON.stringify(buildPayload())
}

function syncOriginalFormState() {
  originalFormString.value = serializeFormState()
}

function hasUnsavedChanges() {
  return originalFormString.value !== '' && originalFormString.value !== serializeFormState()
}

function confirmDiscardChanges() {
  if (!hasUnsavedChanges()) return true
  return window.confirm('您有未儲存的變更，離開將會遺失目前編輯內容，確定繼續嗎？')
}

function normalizeItem(item: any) {
  const legacyActions = Array.isArray(item?.buttons)
    ? item.buttons.map((btn: any, index: number) => ({
        slot: ACTION_SLOT_LABELS[index] || String.fromCharCode(65 + index),
        type: btn?.type === 'message' || btn?.type === 'module' ? btn.type : 'uri',
        uri: btn?.uri || '',
        text: btn?.text || '',
        moduleId: btn?.moduleId || '',
      }))
    : []
  const sourceActions = Array.isArray(item?.actions) && item.actions.length > 0 ? item.actions : legacyActions
  const fallbackLayout = sourceActions.length >= 6 ? 'grid6' : sourceActions.length >= 4 ? 'grid4' : sourceActions.length >= 3 ? 'tripleH' : 'custom'
  const layoutId = LAYOUT_PRESETS.some((layout) => layout.id === item?.layoutId) ? item.layoutId : fallbackLayout
  return {
    ...item,
    name: item?.name || '',
    layoutId,
    transparentBackground: Boolean(item?.transparentBackground),
    altText: item?.altText || '',
    heroImageUrl: item?.heroImageUrl || '',
    actions: normalizeRichMessageActions(layoutId, sourceActions),
  }
}

async function loadItems() {
  loading.value = true
  const [richMessages, flowList] = await Promise.all([
    $fetch<any[]>('/api/rich-message/list').catch(() => []),
    $fetch<any[]>('/api/flow/list').catch(() => []),
  ])
  items.value = (richMessages ?? []).map(normalizeItem)
  flows.value = flowList ?? []
  loading.value = false
  if (!selectedId.value && originalFormString.value === '') {
    syncOriginalFormState()
  }
}

function selectItem(item: any) {
  if (!confirmDiscardChanges()) return
  isCreating.value = false
  selectedId.value = item.id
  form.value = normalizeItem(JSON.parse(JSON.stringify(item)))
  syncOriginalFormState()
}

function openCreate() {
  if (!confirmDiscardChanges()) return
  isCreating.value = true
  selectedId.value = null
  form.value = defaultForm()
  syncOriginalFormState()
}

function cancelEdit() {
  if (!confirmDiscardChanges()) return
  if (selectedItem.value) {
    form.value = normalizeItem(JSON.parse(JSON.stringify(selectedItem.value)))
    isCreating.value = false
  } else {
    isCreating.value = false
    selectedId.value = null
    form.value = defaultForm()
  }
  syncOriginalFormState()
}

function selectLayout(layoutId: RichLayoutId) {
  if (form.value.layoutId === layoutId) return
  form.value.layoutId = layoutId
  form.value.actions = normalizeRichMessageActions(layoutId, form.value.actions)
}

function onSelectRichMessageLayout(layoutId: string) {
  selectLayout(layoutId as RichLayoutId)
}

function switchPresetToCustom() {
  if (isCustomLayout.value) return
  const prevLayout = form.value.layoutId
  const next = form.value.actions.map((action, idx) => ({
    ...action,
    bounds: presetBoundsToCanvas(prevLayout as RichLayoutId, idx),
  }))
  form.value.layoutId = 'custom'
  form.value.actions = normalizeRichMessageActions('custom', next)
}

function addCustomArea() {
  if (!isCustomLayout.value) return
  if (form.value.actions.length >= ACTION_SLOT_LABELS.length) {
    showToast('自訂區域最多 6 個', 'error')
    return
  }
  const next = normalizeRichMessageActions(
    'custom',
    [...form.value.actions, newRichMessageAction('', form.value.actions.length, true)],
  )
  form.value.actions = next
}

function removeCustomArea(index: number) {
  if (!isCustomLayout.value) return
  if (form.value.actions.length <= 1) return
  const next = form.value.actions.filter((_: any, idx: number) => idx !== index)
  form.value.actions = normalizeRichMessageActions('custom', next)
}

function clampCustomArea(index: number) {
  if (!isCustomLayout.value) return
  const action = form.value.actions[index]
  if (!action?.bounds) return
  action.bounds = clampRichMessageBounds(action.bounds)
}

function actionError(action: RichMessageAction) {
  return validateUnifiedAction({
    slot: action.slot,
    type: action.type,
    uri: action.uri,
    text: action.text,
    moduleId: action.moduleId,
  })
}

function startCustomDrag(e: MouseEvent, actionIndex: number) {
  // Preset layout: click/drag area does not auto-convert to custom.
  if (!isCustomLayout.value) return
  startAreaDrag(e, actionIndex)
}

function startCustomResize(e: MouseEvent, actionIndex: number, handle: string) {
  // Only resizing should auto-convert preset -> custom.
  if (!isCustomLayout.value) {
    switchPresetToCustom()
    nextTick(() => startAreaResize(e, actionIndex, handle))
    return
  }
  startAreaResize(e, actionIndex, handle)
}

function validateForm(): string | null {
  if (!form.value.name.trim()) return '請輸入圖文訊息名稱'
  if (!form.value.altText.trim()) return '請輸入提醒文字'
  if (!form.value.heroImageUrl.trim()) return '請上傳背景圖片'
  if (!Array.isArray(form.value.actions) || form.value.actions.length < 1) return '請先選擇版型並設定動作'
  if (form.value.layoutId === 'custom') {
    clampAllAreas()
    if (customOverlapSet.value.size > 0) return '自訂區域有重疊，請調整後再儲存'
  }
  for (const action of form.value.actions) {
    const error = actionError(action)
    if (error) return `區塊 ${action.slot}：${error}`
    if (form.value.layoutId === 'custom') {
      const bounds = action.bounds
      if (!bounds) return `區塊 ${action.slot}：缺少自訂區域範圍`
      if (bounds.width < RICH_MESSAGE_MIN_BOUNDS || bounds.height < RICH_MESSAGE_MIN_BOUNDS) return `區塊 ${action.slot}：區域尺寸過小`
    }
  }
  return null
}

function buildPayload() {
  const normalized = serializeRichMessageActionsForApi(form.value.layoutId, form.value.actions)
  return {
    name: form.value.name.trim(),
    layoutId: form.value.layoutId,
    transparentBackground: form.value.transparentBackground,
    altText: form.value.altText.trim(),
    heroImageUrl: form.value.heroImageUrl.trim(),
    actions: normalized,
    isActive: true,
  }
}

async function submitForm() {
  const error = validateForm()
  if (error) return showToast(error, 'error')

  saving.value = true
  try {
    if (isCreating.value) {
      const created = await $fetch<any>('/api/rich-message/create', { method: 'POST', body: buildPayload() })
      showToast('圖文訊息已建立 ✅', 'success')
      await loadItems()
      const next = items.value.find(item => item.id === created.id) ?? items.value[0]
      if (next) selectItem(next)
      isCreating.value = false
      syncOriginalFormState()
    } else {
      await $fetch(`/api/rich-message/${selectedId.value}`, { method: 'PUT', body: buildPayload() })
      showToast('圖文訊息已更新 ✅', 'success')
      await loadItems()
      const next = items.value.find(item => item.id === selectedId.value)
      if (next) selectItem(next)
      syncOriginalFormState()
    }
  } catch {
    showToast('儲存失敗', 'error')
  } finally {
    saving.value = false
  }
}

async function deleteItem() {
  if (!selectedId.value || !confirm(`確定刪除「${form.value.name}」？`)) return
  try {
    await $fetch(`/api/rich-message/${selectedId.value}`, { method: 'DELETE' })
    showToast('已刪除', 'success')
    selectedId.value = null
    form.value = defaultForm()
    await loadItems()
    syncOriginalFormState()
  } catch {
    showToast('刪除失敗', 'error')
  }
}

onMounted(() => {
  loadItems()
  bindAreaWindowListeners()
})

onBeforeUnmount(() => {
  unbindAreaWindowListeners()
})
</script>
