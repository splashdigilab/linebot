<template>
  <AdminSplitLayout :is-empty="!selectedFlow && !isCreating">
    <!-- ── Sidebar Header ── -->
    <template #sidebar-header>
      <span class="split-sidebar-title">🤖 機器人模組</span>
      <el-button type="primary" size="small" @click="openCreate">➕ 新增</el-button>
    </template>

    <!-- ── Sidebar List ── -->
    <template #sidebar-list>
      <div v-if="loading" class="split-sidebar-loading">
        <div class="spinner" />
      </div>
      <div v-else-if="!flows.length" class="split-sidebar-empty">
        <span>尚無模組</span>
        <el-button size="small" type="primary" plain @click="openCreate">立即建立</el-button>
      </div>
      <div v-else class="split-list">
        <button
          v-for="flow in flows"
          :key="flow.id"
          class="split-list-item"
          :class="{ active: selectedId === flow.id }"
          @click="selectFlow(flow)"
        >
          <div class="split-list-name">{{ flow.name }}</div>
          <div class="split-list-meta">
            <span class="text-xs text-muted">{{ flow.messages?.length ?? 0 }} 則訊息</span>
          </div>
        </button>
      </div>
    </template>

    <!-- ── Empty State ── -->
    <template #editor-empty>
      <span class="empty-icon">🤖</span>
      <h3>選擇一個模組開始編輯</h3>
      <p>或點擊左側「➕ 新增」建立一個全新的回覆模組</p>
      <el-button type="primary" @click="openCreate">建立模組</el-button>
    </template>

    <!-- ── Editor Header ── -->
    <template #editor-header>
      <div style="flex: 1;">
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
          <span v-if="isCreating" class="split-editor-title">新增模組:</span>
          <el-input
            v-model="form.name"
            size="large"
            style="max-width: 400px;"
            placeholder="請輸入模組名稱..."
          />
        </div>
        <p class="text-sm text-muted" style="margin-top:0.25rem; padding-left: 0.5rem;">
          共 {{ form.messages.length }} 則回覆訊息
        </p>
      </div>
      <div class="flex gap-1">
        <el-button v-if="!isCreating && selectedFlow" type="danger" @click="deleteFlow">
          🗑️ 刪除
        </el-button>
        <el-button @click="cancelEdit">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">
          {{ isCreating ? '建立模組' : '儲存變更' }}
        </el-button>
      </div>
    </template>

    <!-- ── Editor Body ── -->
    <template #editor-body>
      <div class="flow-editor-messages">
        <!-- Sticky header -->
        <div class="fem-header">
          <span class="config-section-title" style="margin:0;">💬 回覆訊息</span>
          <div class="msg-type-btns">
            <el-button size="small" @click="addMessage('text')">＋ 文字</el-button>
            <el-button size="small" @click="addMessage('image')">＋ 圖片</el-button>
            <el-button size="small" @click="addMessage('video')">＋ 影片</el-button>
            <el-button size="small" @click="addMessage('carousel')">＋ 輪播</el-button>
            <el-button size="small" @click="addMessage('imageCarousel')">＋ 圖片輪播</el-button>
          </div>
        </div>

        <!-- Card rail (horizontal scroll) -->
        <div class="fem-rail">
          <div v-if="!form.messages.length" class="fem-empty">
            <span>尚無訊息</span>
            <p class="text-xs text-muted">點擊上方按鈕新增</p>
          </div>

          <!-- Message Cards + Carousel Blocks -->
          <template v-for="(msg, i) in form.messages" :key="i">

            <!-- ── Normal card: text / image / video ── -->
            <div
              v-if="!isCarouselType(msg.type)"
              class="message-card"
              :class="{ dragging: dragIndex === i, 'drag-over': dragOverIndex === i && dragIndex !== i }"
              @dragover.prevent="onDragOver($event, i)"
              @dragenter.prevent
              @dragleave="onDragLeave"
              @drop="onDrop($event, i)"
            >
              <div class="message-card-header">
                <div class="flex gap-1" style="align-items: center;">
                  <span class="drag-handle" draggable="true" @dragstart="onDragStart($event, i)" @dragend="onDragEnd">⠿</span>
                  <span class="badge" :class="msgBadgeClass(msg.type)">{{ msgTypeLabel(msg.type) }}</span>
                </div>
                <el-button link type="danger" style="padding:0.1rem 0.4rem;" @click="removeMessage(i)">✕</el-button>
              </div>

              <!-- Text -->
              <div v-if="msg.type === 'text'" class="message-bubble-wrap">
                <el-input v-model="msg.text" type="textarea" :rows="3" placeholder="輸入回覆文字..." :maxlength="msg.buttons && msg.buttons.length > 0 ? 160 : 5000" show-word-limit />
                <div v-if="msg.buttons && msg.buttons.length" class="message-buttons-list">
                  <div v-for="(btn, bIdx) in msg.buttons" :key="bIdx" class="action-button-editor">
                    <div class="flex gap-1 items-center" style="margin-bottom: 0.5rem;">
                      <el-select v-model="btn.type" size="small" style="width: 120px;">
                        <el-option value="message" label="傳送文字" />
                        <el-option value="uri" label="開啟網址" />
                      </el-select>
                      <el-button link type="danger" style="margin-left: auto;" @click="removeButton(msg, bIdx)">✕</el-button>
                    </div>
                    <el-input v-model="btn.label" placeholder="按鈕名稱 (最多 20 字)" maxlength="20" style="margin-bottom: 0.5rem;" show-word-limit />
                    <el-input v-if="btn.type === 'message'" v-model="btn.text" placeholder="用戶點擊後傳送的文字..." maxlength="300" show-word-limit />
                    <el-input v-if="btn.type === 'uri'" v-model="btn.uri" placeholder="https://..." />
                  </div>
                </div>
                <el-button v-if="!msg.buttons || msg.buttons.length < 4" plain style="width: 100%; justify-content: center; border-style: dashed; margin-top: 0.5rem;" @click="addButton(msg)">
                  ⊕ 新增按鈕 (非必需)
                </el-button>
              </div>

              <!-- Image -->
              <div v-else-if="msg.type === 'image'" class="message-image-wrap">
                <FlowUploadZone v-model="msg.originalContentUrl" type="image" label="點擊上傳圖片" @update:model-value="(v) => { msg.previewImageUrl = v }" />
              </div>

              <!-- Video -->
              <div v-else-if="msg.type === 'video'" class="message-video-wrap">
                <p class="fuz-section-label">預覽圖片 <span class="text-muted">(長寬大小與影片一樣)</span></p>
                <FlowUploadZone v-model="msg.previewImageUrl" type="image" label="點擊上傳預覽圖" hint="建議與影片同尺寸" />
                <p class="fuz-section-label" style="margin-top: 0.75rem;">影片檔案 <span class="text-muted">(大小不可超過 5 MB)</span></p>
                <FlowUploadZone v-model="msg.originalContentUrl" type="video" label="點擊上傳影片" hint="支援 MP4，最大 5MB" />
              </div>
            </div>

            <!-- ── Carousel block (flat stretch, but parent config is a standard card) ── -->
            <div
              v-else
              class="carousel-block"
              :class="{ dragging: dragIndex === i, 'drag-over': dragOverIndex === i && dragIndex !== i }"
              @dragover.prevent="onDragOver($event, i)"
              @dragenter.prevent
              @dragleave="onDragLeave"
              @drop="onDrop($event, i)"
            >
              <!-- 1. The Parent Config Card (Exactly matches 380px standard card) -->
              <div class="message-card">
                <!-- Standard Header -->
                <div class="message-card-header">
                  <div class="flex gap-1" style="align-items: center;">
                    <span class="drag-handle" draggable="true" @dragstart="onDragStart($event, i)" @dragend="onDragEnd">⠿</span>
                    <span class="badge" :class="msgBadgeClass(msg.type)">{{ msgTypeLabel(msg.type) }}</span>
                  </div>
                  <el-button link type="danger" style="padding:0.1rem 0.4rem;" @click="removeMessage(i)">✕</el-button>
                </div>
                
                <!-- Alt Text body (reusing standard padding) -->
                <div class="carousel-alt-wrap" style="padding: 1rem; display: flex; flex-direction: column; gap: 0.65rem;">
                  <el-input
                    v-model="msg.altText"
                    :placeholder="msg.type === 'imageCarousel' ? '訊息提醒文字（最多 400 字）' : '訊息提醒文字（不支援 Flex 時顯示，最多 400 字）'"
                    maxlength="400"
                    show-word-limit
                  />
                  <p v-if="msg.type === 'imageCarousel'" class="fuz-hint-text" style="margin-bottom:0;">
                    圖片長度不可超過寬度的 3 倍，小於 500 KB，建議每張比例相同
                  </p>
                </div>
              </div>

              <!-- 2. Horizontal sub-card rail ── -->
              <div class="carousel-cards-scroll" style="margin-top: 0.25rem;">

                <!-- Carousel sub-cards -->
                <template v-if="msg.type === 'carousel'">
                  <div v-for="(col, ci) in msg.columns" :key="ci" class="carousel-sub-card">
                    <div class="carousel-card-top">
                      <span class="carousel-card-idx">{{ ci + 1 }}</span>
                      <el-button v-if="msg.columns.length > 1" link type="danger" size="small" @click="msg.columns.splice(ci, 1)">✕</el-button>
                    </div>
                    <div class="carousel-sub-body">
                      <FlowUploadZone v-model="col.thumbnailImageUrl" type="image" label="上傳縮圖" preview-height="140px" />
                      <el-input v-model="col.title" placeholder="標題（必填，最多 80 字）" maxlength="80" show-word-limit style="margin-top:0.5rem;" />
                      <el-input v-model="col.text" type="textarea" :rows="2" placeholder="副標題或內容（最多 300 字）" maxlength="300" show-word-limit style="margin-top:0.5rem;" />
                      <div v-if="col.actions?.length" class="carousel-actions">
                        <div v-for="(act, ai) in col.actions" :key="ai" class="carousel-action-row">
                          <el-select v-model="act.type" size="small" style="width:90px;flex-shrink:0;">
                            <el-option value="uri" label="開網址" />
                            <el-option value="message" label="傳文字" />
                          </el-select>
                          <el-input v-model="act.label" placeholder="按鈕文字" maxlength="20" size="small" style="flex:1;" />
                          <el-input v-if="act.type==='uri'" v-model="act.uri" placeholder="https://..." size="small" style="flex:2;" />
                          <el-input v-else v-model="act.text" placeholder="傳送文字" size="small" style="flex:2;" />
                          <el-button link type="danger" size="small" @click="col.actions.splice(ai,1)">✕</el-button>
                        </div>
                      </div>
                      <el-button v-if="!col.actions || col.actions.length < 3" plain size="small" style="width:100%;border-style:dashed;margin-top:0.5rem;" @click="addCarouselAction(col)">⊕ 新增按鈕</el-button>
                    </div>
                  </div>
                </template>

                <!-- imageCarousel sub-cards -->
                <template v-else>
                  <div v-for="(col, ci) in msg.columns" :key="ci" class="carousel-sub-card">
                    <div class="carousel-card-top">
                      <span class="carousel-card-idx">{{ ci + 1 }}</span>
                      <el-button v-if="msg.columns.length > 1" link type="danger" size="small" @click="msg.columns.splice(ci, 1)">✕</el-button>
                    </div>
                    <div class="carousel-sub-body">
                      <FlowUploadZone v-model="col.imageUrl" type="image" label="上傳" preview-height="160px" />
                      <p class="fuz-section-label" style="margin-top:0.75rem;">圖片動作</p>
                      <el-select v-model="col.action.type" size="small" style="width:100%;">
                        <el-option value="none" label="未有行動" />
                        <el-option value="uri" label="開啟網址" />
                        <el-option value="message" label="傳送文字" />
                      </el-select>
                      <el-input v-if="col.action.type==='uri'" v-model="col.action.uri" placeholder="https://..." size="small" style="margin-top:0.4rem;" />
                      <el-input v-else-if="col.action.type==='message'" v-model="col.action.text" placeholder="點擊後傳送的文字" size="small" style="margin-top:0.4rem;" />
                    </div>
                  </div>
                </template>

                <!-- Add sub-card button -->
                <button
                  v-if="msg.columns.length < 10"
                  class="carousel-add-card"
                  @click="msg.type === 'carousel' ? addCarouselColumn(msg) : addImageCarouselColumn(msg)"
                >
                  <span style="font-size:1.5rem;color:var(--text-muted);">＋</span>
                </button>
              </div>
            </div>

          </template>
          <!-- End rail -->
          </div>
        </div>

    </template>
  </AdminSplitLayout>

  <!-- Toast -->
  <div class="toast-bar">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">
      <span>{{ t.type === 'success' ? '✅' : '❌' }}</span>
      <span>{{ t.msg }}</span>
    </div>
  </div>
</template>


<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'default' })

// ── State ─────────────────────────────────────────────
const flows = ref<any[]>([])
const loading = ref(true)
const saving = ref(false)
const selectedId = ref<string | null>(null)
const isCreating = ref(false)
const toasts = ref<{ id: number; msg: string; type: 'success' | 'error' }[]>([])

// Drag and Drop State
const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

const defaultForm = () => ({
  name: '',
  messages: [] as any[],
})
const form = ref(defaultForm())

const selectedFlow = computed(() => flows.value.find(f => f.id === selectedId.value) ?? null)

// ── Badge helpers ─────────────────────────────────────
const MSG_META: Record<string, { label: string; badge: string }> = {
  text:          { label: '📝 文字訊息',  badge: 'badge-blue'   },
  image:         { label: '🖼️ 圖片訊息', badge: 'badge-orange' },
  video:         { label: '🎬 影片訊息', badge: 'badge-gray'   },
  carousel:      { label: '🎠 輪播訊息', badge: 'badge-green'  },
  imageCarousel: { label: '🖼️ 圖片輪播', badge: 'badge-gray'  },
}

function msgTypeLabel(type: string) {
  return MSG_META[type]?.label ?? type
}

function msgBadgeClass(type: string) {
  return MSG_META[type]?.badge ?? 'badge-gray'
}

function isCarouselType(type: string) {
  return type === 'carousel' || type === 'imageCarousel'
}

// ── Load ──────────────────────────────────────────────
async function loadFlows() {
  loading.value = true
  flows.value = await $fetch<any[]>('/api/flow/list').catch(() => [])
  loading.value = false
}
onMounted(loadFlows)

// ── Select / Create ───────────────────────────────────
function selectFlow(flow: any) {
  isCreating.value = false
  selectedId.value = flow.id
  form.value = {
    name: flow.name,
    messages: JSON.parse(JSON.stringify(flow.messages ?? [])),
  }
}

function openCreate() {
  isCreating.value = true
  selectedId.value = null
  form.value = defaultForm()
}

function cancelEdit() {
  if (selectedFlow.value) {
    selectFlow(selectedFlow.value)
    isCreating.value = false
  } else {
    isCreating.value = false
    selectedId.value = null
    form.value = defaultForm()
  }
}

// ── Messages ──────────────────────────────────────────
function addMessage(type: string) {
  if (type === 'text') {
    form.value.messages.push({ type: 'text', text: '', buttons: [] })
  } else if (type === 'image') {
    form.value.messages.push({ type: 'image', originalContentUrl: '', previewImageUrl: '' })
  } else if (type === 'video') {
    form.value.messages.push({ type: 'video', originalContentUrl: '', previewImageUrl: '' })
  } else if (type === 'carousel') {
    form.value.messages.push({
      type: 'carousel',
      altText: '',
      columns: [newCarouselColumn()],
    })
  } else if (type === 'imageCarousel') {
    form.value.messages.push({
      type: 'imageCarousel',
      altText: '',
      columns: [newImageCarouselColumn()],
    })
  }
}

function newCarouselColumn() {
  return {
    thumbnailImageUrl: '',
    title: '',
    text: '',
    actions: [],
  }
}

function newImageCarouselColumn() {
  return {
    imageUrl: '',
    action: { type: 'none', uri: '', text: '', label: '' },
  }
}

function addCarouselColumn(msg: any) {
  if (msg.columns.length < 10) msg.columns.push(newCarouselColumn())
}

function addImageCarouselColumn(msg: any) {
  if (msg.columns.length < 10) msg.columns.push(newImageCarouselColumn())
}

function addCarouselAction(col: any) {
  if (!col.actions) col.actions = []
  if (col.actions.length < 3) col.actions.push({ type: 'uri', label: '', uri: '', text: '' })
}

function removeMessage(i: number) {
  form.value.messages.splice(i, 1)
}

// ── Buttons (text type) ───────────────────────────────
function addButton(msg: any) {
  if (!msg.buttons) msg.buttons = []
  if (msg.buttons.length >= 4) {
    showToast('最多只能新增 4 個按鈕', 'error')
    return
  }
  msg.buttons.push({ type: 'message', label: '', text: '', uri: '' })
}

function removeButton(msg: any, bIdx: number) {
  if (msg.buttons) msg.buttons.splice(bIdx, 1)
}

// ── Drag and Drop ─────────────────────────────────────
function onDragStart(e: DragEvent, i: number) {
  dragIndex.value = i
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.dropEffect = 'move'
    e.dataTransfer.setData('text/plain', i.toString())
  }
  setTimeout(() => {}, 0)
}

function onDragOver(_e: DragEvent, i: number) {
  dragOverIndex.value = i
}

function onDragLeave() {
  dragOverIndex.value = null
}

function onDragEnd() {
  dragIndex.value = null
  dragOverIndex.value = null
}

function onDrop(e: DragEvent, dropIndex: number) {
  const fromIndex = dragIndex.value
  if (fromIndex !== null && fromIndex !== dropIndex) {
    const item = form.value.messages.splice(fromIndex, 1)[0]
    form.value.messages.splice(dropIndex, 0, item)
  }
  dragIndex.value = null
  dragOverIndex.value = null
}

// ── Save / Delete ─────────────────────────────────────
async function submitForm() {
  if (!form.value.name) return showToast('請輸入模組名稱', 'error')
  if (!form.value.messages.length) return showToast('請至少新增一則回覆訊息', 'error')

  saving.value = true
  try {
    if (isCreating.value) {
      const res = await $fetch<any>('/api/flow/create', {
        method: 'POST',
        body: {
          name: form.value.name,
          messages: form.value.messages,
          isActive: true,
        },
      })
      showToast('模組已建立 ✅', 'success')
      await loadFlows()
      const newFlow = flows.value.find(f => f.id === res.id) ?? flows.value[0]
      if (newFlow) selectFlow(newFlow)
      isCreating.value = false
    } else {
      await $fetch(`/api/flow/${selectedId.value}`, {
        method: 'PUT',
        body: {
          name: form.value.name,
          messages: form.value.messages,
          isActive: true,
        },
      })
      showToast('模組已更新 ✅', 'success')
      await loadFlows()
    }
  } catch {
    showToast('儲存失敗', 'error')
  } finally {
    saving.value = false
  }
}

async function deleteFlow() {
  if (!selectedId.value || !confirm(`確定刪除「${form.value.name}」？`)) return
  try {
    await $fetch(`/api/flow/${selectedId.value}`, { method: 'DELETE' })
    showToast('已刪除', 'success')
    selectedId.value = null
    form.value = defaultForm()
    await loadFlows()
  } catch {
    showToast('刪除失敗', 'error')
  }
}

// ── Helpers ───────────────────────────────────────────
let toastId = 0
function showToast(msg: string, type: 'success' | 'error') {
  const id = ++toastId
  toasts.value.push({ id, msg, type })
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 3500)
}
</script>


