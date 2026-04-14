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
            <el-button size="small" @click="addMessage('quickReply')">＋ 快速回覆</el-button>
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
              v-if="msg.type === 'text' || msg.type === 'image' || msg.type === 'video'"
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
                <div v-if="msg.buttons && msg.buttons.length" class="carousel-actions">
                  <div v-for="(btn, bIdx) in msg.buttons" :key="bIdx" class="carousel-action-row">
                    <div class="carousel-action-row-top">
                      <span class="carousel-action-index">按鈕 {{ Number(bIdx) + 1 }}</span>
                      <el-button
                        link
                        type="danger"
                        size="small"
                        @click="removeButton(msg, Number(bIdx))"
                      >
                        ✕
                      </el-button>
                    </div>
                    <el-select v-model="btn.type" size="small" style="width:100%;">
                      <el-option value="uri" label="開網址" />
                      <el-option value="message" label="傳文字" />
                      <el-option value="module" label="觸發模組" />
                    </el-select>
                    <el-input v-model="btn.label" placeholder="按鈕文字" maxlength="20" size="small" />
                    <el-select v-if="btn.type === 'module'" v-model="btn.moduleId" placeholder="選擇機器人模組" size="small" style="width: 100%;">
                      <el-option v-for="f in flows" :key="f.id" :value="f.id" :label="f.name" />
                    </el-select>
                    <el-input v-else-if="btn.type === 'uri'" v-model="btn.uri" placeholder="https://..." size="small" />
                    <el-input v-else v-model="btn.text" placeholder="傳送文字" size="small" />
                  </div>
                </div>
                <el-button v-if="!msg.buttons || msg.buttons.length < 4" plain size="small" style="width: 100%; border-style: dashed; margin-top: 0.5rem;" @click="addButton(msg)">
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
              </div>
            </div>

            <!-- ── Quick Reply block (Carousel layout) ── -->
            <div
              v-else-if="msg.type === 'quickReply'"
              class="carousel-block"
              :class="{ dragging: dragIndex === i, 'drag-over': dragOverIndex === i && dragIndex !== i }"
              @dragover.prevent="onDragOver($event, i)"
              @dragenter.prevent
              @dragleave="onDragLeave"
              @drop="onDrop($event, i)"
            >
              <!-- Parent Config Card -->
              <div class="message-card">
                <div class="message-card-header">
                  <div class="flex gap-1" style="align-items: center;">
                    <span class="drag-handle" draggable="true" @dragstart="onDragStart($event, i)" @dragend="onDragEnd">⠿</span>
                    <span class="badge badge-purple">⚡ 快速回覆</span>
                  </div>
                  <el-button link type="danger" style="padding:0.1rem 0.4rem;" @click="removeMessage(i)">✕</el-button>
                </div>
                <!-- Text input for the bubble! -->
                <div class="carousel-alt-wrap" style="padding: 1rem; display: flex; flex-direction: column; gap: 0.65rem;">
                  <p class="fuz-section-label" style="margin-bottom:0;">搭配的文字內容 <span class="text-muted">(必需輸入)</span></p>
                  <el-input
                    v-model="msg.text"
                    type="textarea"
                    :rows="2"
                    placeholder="請輸入主要回覆文字..."
                    maxlength="5000"
                    show-word-limit
                  />
                </div>
              </div>

              <!-- Sub-card horizontal rail ── -->
              <div class="carousel-cards-scroll" style="margin-top: 0.25rem;">
                <div
                  v-for="(qr, qi) in msg.quickReplies" :key="qi"
                  class="carousel-sub-card"
                  :class="{ 'col-dragging': qrDragMsgIndex === i && qrDragIndex === qi, 'col-drag-over': qrDragMsgIndex === i && qrDragOverIndex === qi && qrDragIndex !== qi }"
                  @dragover.prevent.stop="onQrDragOver($event, i, qi)"
                  @dragenter.prevent.stop
                  @dragleave.stop="onQrDragLeave"
                  @drop.stop="onQrDrop($event, i, qi)"
                >
                  <div class="carousel-card-top">
                    <div class="flex gap-1 items-center">
                      <span class="drag-handle" draggable="true" @dragstart.stop="onQrDragStart($event, i, qi)" @dragend.stop="onQrDragEnd">⠿</span>
                      <span class="carousel-card-idx">{{ Number(qi) + 1 }}</span>
                    </div>
                    <el-button link type="danger" size="small" @click="removeQuickReply(msg, qi)">✕</el-button>
                  </div>
                  <div class="carousel-sub-body" style="padding-top: 0.5rem;">
                    <!-- Action Config -->
                    <div class="carousel-actions">
                      <div class="carousel-action-row">
                        <div class="carousel-action-row-top">
                          <span class="carousel-action-index">按鈕動作</span>
                        </div>
                        <el-select v-model="qr.action.type" size="small" style="width: 100%;">
                          <el-option value="message" label="傳送文字" />
                          <el-option value="uri" label="開啟網址" />
                          <el-option value="module" label="觸發模組" />
                        </el-select>
                        <el-input v-model="qr.action.label" placeholder="按鈕名稱 (必填，限 20 字)" maxlength="20" size="small" show-word-limit />
                        <el-select v-if="qr.action.type === 'module'" v-model="qr.action.moduleId" placeholder="選擇機器人模組" size="small" style="width: 100%;">
                          <el-option v-for="f in flows" :key="f.id" :value="f.id" :label="f.name" />
                        </el-select>
                        <el-input v-else-if="qr.action.type === 'message'" v-model="qr.action.text" placeholder="回覆文字" size="small" />
                        <el-input v-else-if="qr.action.type === 'uri'" v-model="qr.action.uri" placeholder="https://..." size="small" />
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Add Button -->
                <button v-if="!msg.quickReplies || msg.quickReplies.length < 13" class="carousel-add-card" @click="addQuickReply(msg)">
                  <span style="font-size:1.5rem;color:var(--text-muted);">＋</span>
                </button>
              </div>
            </div>

            <!-- ── Carousel block (flat stretch, but parent config is a standard card) ── -->
            <div
              v-else-if="msg.type === 'carousel' || msg.type === 'imageCarousel'"
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
                  <div
                    v-for="(col, ci) in msg.columns" :key="ci"
                    class="carousel-sub-card"
                    :class="{ 'col-dragging': colDragMsgIndex === i && colDragIndex === ci, 'col-drag-over': colDragMsgIndex === i && colDragOverIndex === ci && colDragIndex !== ci }"
                    @dragover.prevent.stop="onColDragOver($event, i, ci)"
                    @dragenter.prevent.stop
                    @dragleave.stop="onColDragLeave"
                    @drop.stop="onColDrop($event, i, ci)"
                  >
                    <div class="carousel-card-top">
                      <div class="flex gap-1 items-center">
                        <span class="drag-handle" draggable="true" @dragstart.stop="onColDragStart($event, i, ci)" @dragend.stop="onColDragEnd">⠿</span>
                        <span class="carousel-card-idx">{{ Number(ci) + 1 }}</span>
                      </div>
                      <el-button v-if="msg.columns.length > 1" link type="danger" size="small" @click="msg.columns.splice(ci, 1)">✕</el-button>
                    </div>
                    <div class="carousel-sub-body">
                      <FlowUploadZone v-model="col.thumbnailImageUrl" type="image" label="上傳縮圖" preview-height="140px" />
                      <el-input v-model="col.title" placeholder="標題（必填，最多 80 字）" maxlength="80" show-word-limit style="margin-top:0.5rem;" />
                      <el-input v-model="col.text" type="textarea" :rows="2" placeholder="副標題或內容（最多 300 字）" maxlength="300" show-word-limit style="margin-top:0.5rem;" />
                      <div v-if="col.actions?.length" class="carousel-actions">
                        <div v-for="(act, ai) in col.actions" :key="ai" class="carousel-action-row">
                          <div class="carousel-action-row-top">
                            <span class="carousel-action-index">按鈕 {{ Number(ai) + 1 }}</span>
                            <el-button
                              link
                              type="danger"
                              size="small"
                              :disabled="col.actions.length <= 1"
                              @click="removeCarouselAction(col, Number(ai))"
                            >
                              ✕
                            </el-button>
                          </div>
                          <el-select v-model="act.type" size="small" style="width:100%;">
                            <el-option value="uri" label="開網址" />
                            <el-option value="message" label="傳文字" />
                            <el-option value="module" label="觸發模組" />
                          </el-select>
                          <el-input v-model="act.label" placeholder="按鈕文字" maxlength="20" size="small" />
                          <el-select v-if="act.type === 'module'" v-model="act.moduleId" placeholder="選擇機器人模組" size="small" style="width: 100%;">
                            <el-option v-for="f in flows" :key="f.id" :value="f.id" :label="f.name" />
                          </el-select>
                          <el-input v-else-if="act.type==='uri'" v-model="act.uri" placeholder="https://..." size="small" />
                          <el-input v-else v-model="act.text" placeholder="傳送文字" size="small" />
                        </div>
                      </div>
                      <el-button v-if="!col.actions || col.actions.length < 3" plain size="small" style="width:100%;border-style:dashed;margin-top:0.5rem;" @click="addCarouselAction(col)">⊕ 新增按鈕</el-button>
                    </div>
                  </div>
                </template>

                <!-- imageCarousel sub-cards -->
                <template v-else>
                  <div
                    v-for="(col, ci) in msg.columns" :key="ci"
                    class="carousel-sub-card"
                    :class="{ 'col-dragging': colDragMsgIndex === i && colDragIndex === ci, 'col-drag-over': colDragMsgIndex === i && colDragOverIndex === ci && colDragIndex !== ci }"
                    @dragover.prevent.stop="onColDragOver($event, i, ci)"
                    @dragenter.prevent.stop
                    @dragleave.stop="onColDragLeave"
                    @drop.stop="onColDrop($event, i, ci)"
                  >
                    <div class="carousel-card-top">
                      <div class="flex gap-1 items-center">
                        <span class="drag-handle" draggable="true" @dragstart.stop="onColDragStart($event, i, ci)" @dragend.stop="onColDragEnd">⠿</span>
                        <span class="carousel-card-idx">{{ Number(ci) + 1 }}</span>
                      </div>
                      <el-button v-if="msg.columns.length > 1" link type="danger" size="small" @click="msg.columns.splice(ci, 1)">✕</el-button>
                    </div>
                    <div class="carousel-sub-body">
                      <FlowUploadZone v-model="col.imageUrl" type="image" label="上傳" preview-height="160px" />
                      <div class="carousel-actions" style="margin-top:0.75rem;">
                        <div class="carousel-action-row">
                          <div class="carousel-action-row-top">
                            <span class="carousel-action-index">圖片動作</span>
                          </div>
                          <el-select v-model="col.action.type" size="small" style="width:100%;">
                            <el-option value="none" label="未有行動" />
                            <el-option value="uri" label="開啟網址" />
                            <el-option value="message" label="傳送文字" />
                            <el-option value="module" label="觸發模組" />
                          </el-select>
                          <el-input
                            v-if="col.action.type !== 'none'"
                            v-model="col.action.label"
                            placeholder="按鈕文字 (必填)"
                            maxlength="20"
                            size="small"
                          />
                          <el-select v-if="col.action.type === 'module'" v-model="col.action.moduleId" placeholder="選擇機器人模組" size="small" style="width: 100%;">
                            <el-option v-for="f in flows" :key="f.id" :value="f.id" :label="f.name" />
                          </el-select>
                          <el-input v-else-if="col.action.type==='uri'" v-model="col.action.uri" placeholder="https://..." size="small" />
                          <el-input v-else-if="col.action.type==='message'" v-model="col.action.text" placeholder="點擊後傳送的文字" size="small" />
                        </div>
                      </div>
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

// Carousel column Drag and Drop State
const colDragMsgIndex = ref<number | null>(null)
const colDragIndex = ref<number | null>(null)
const colDragOverIndex = ref<number | null>(null)

// Quick Reply Drag and Drop State
const qrDragMsgIndex = ref<number | null>(null)
const qrDragIndex = ref<number | null>(null)
const qrDragOverIndex = ref<number | null>(null)


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
  quickReply:    { label: '⚡ 快速回覆', badge: 'badge-purple' },
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
    messages: normalizeMessages(JSON.parse(JSON.stringify(flow.messages ?? []))),
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
  } else if (type === 'quickReply') {
    const existingIndex = form.value.messages.findIndex(m => m.type === 'quickReply')
    if (existingIndex > -1) {
      showToast('只能加入一個快速回覆區塊', 'error')
      return
    }
    form.value.messages.push({
      type: 'quickReply',
      text: '',
      quickReplies: [newQuickReplyAction()]
    })
  }
}


function newCarouselColumn() {
  return {
    thumbnailImageUrl: '',
    title: '',
    text: '',
    actions: [newCarouselAction()],
  }
}

function newCarouselAction() {
  return { type: 'uri', label: '', uri: '', text: '' }
}

function newImageCarouselColumn() {
  return {
    imageUrl: '',
    action: { type: 'none', uri: '', text: '', label: '' },
  }
}

function newQuickReplyAction() {
  return { imageUrl: '', action: { type: 'message', label: '', text: '' } }
}

function addCarouselColumn(msg: any) {
  if (msg.columns.length < 10) msg.columns.push(newCarouselColumn())
}

function addImageCarouselColumn(msg: any) {
  if (msg.columns.length < 10) msg.columns.push(newImageCarouselColumn())
}

function addCarouselAction(col: any) {
  if (!col.actions) col.actions = []
  if (col.actions.length < 3) col.actions.push(newCarouselAction())
}

function removeCarouselAction(col: any, actionIndex: number) {
  if (!col.actions || col.actions.length <= 1) return
  col.actions.splice(actionIndex, 1)
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

// ── Quick Replies ─────────────────────────────────────
function addQuickReply(msg: any) {
  if (!msg.quickReplies) msg.quickReplies = []
  if (msg.quickReplies.length < 13) {
    msg.quickReplies.push(newQuickReplyAction())
  }
}

function removeQuickReply(msg: any, qi: number) {
  if (msg.quickReplies) msg.quickReplies.splice(qi, 1)
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

// ── Carousel Column Drag and Drop ──────────────────────────
function onColDragStart(e: DragEvent, msgIndex: number, colIndex: number) {
  colDragMsgIndex.value = msgIndex
  colDragIndex.value = colIndex
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.dropEffect = 'move'
    e.dataTransfer.setData('text/plain', colIndex.toString())
  }
  setTimeout(() => {}, 0)
}

function onColDragOver(e: DragEvent, msgIndex: number, colIndex: number) {
  if (colDragMsgIndex.value === msgIndex) {
    colDragOverIndex.value = colIndex
  }
}

function onColDragLeave() {
  colDragOverIndex.value = null
}

function onColDragEnd() {
  colDragMsgIndex.value = null
  colDragIndex.value = null
  colDragOverIndex.value = null
}

function onColDrop(e: DragEvent, msgIndex: number, dropIndex: number) {
  if (colDragMsgIndex.value === msgIndex && colDragIndex.value !== null && colDragIndex.value !== dropIndex) {
    const fromIndex = colDragIndex.value
    const columns = form.value.messages[msgIndex].columns
    const item = columns.splice(fromIndex, 1)[0]
    columns.splice(dropIndex, 0, item)
  }
  colDragMsgIndex.value = null
  colDragIndex.value = null
  colDragOverIndex.value = null
}

// ── Quick Reply Drag and Drop ──────────────────────────
function onQrDragStart(e: DragEvent, msgIndex: number, qrIndex: number) {
  qrDragMsgIndex.value = msgIndex
  qrDragIndex.value = qrIndex
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.dropEffect = 'move'
    e.dataTransfer.setData('text/plain', qrIndex.toString())
  }
  setTimeout(() => {}, 0)
}

function onQrDragOver(e: DragEvent, msgIndex: number, qrIndex: number) {
  if (qrDragMsgIndex.value === msgIndex) {
    qrDragOverIndex.value = qrIndex
  }
}

function onQrDragLeave() {
  qrDragOverIndex.value = null
}

function onQrDragEnd() {
  qrDragMsgIndex.value = null
  qrDragIndex.value = null
  qrDragOverIndex.value = null
}

function onQrDrop(e: DragEvent, msgIndex: number, dropIndex: number) {
  if (qrDragMsgIndex.value === msgIndex && qrDragIndex.value !== null && qrDragIndex.value !== dropIndex) {
    const fromIndex = qrDragIndex.value
    const qrArray = form.value.messages[msgIndex].quickReplies
    const item = qrArray.splice(fromIndex, 1)[0]
    qrArray.splice(dropIndex, 0, item)
  }
  qrDragMsgIndex.value = null
  qrDragIndex.value = null
  qrDragOverIndex.value = null
}

// ── Save / Delete ─────────────────────────────────────
async function submitForm() {
  if (!form.value.name) return showToast('請輸入模組名稱', 'error')
  if (!form.value.messages.length) return showToast('請至少新增一則回覆訊息', 'error')

  form.value.messages = normalizeMessages(form.value.messages)
  const validationError = validateMessages(form.value.messages)
  if (validationError) return showToast(validationError, 'error')

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

function normalizeMessages(messages: any[]) {
  return (messages ?? []).map((msg) => {
    if (msg.type === 'quickReply') {
      return {
        ...msg,
        text: msg.text || '',
        quickReplies: Array.isArray(msg.quickReplies) && msg.quickReplies.length > 0 ? msg.quickReplies : [newQuickReplyAction()]
      }
    }
    
    if (msg.type !== 'carousel') return msg

    const columns = Array.isArray(msg.columns) ? msg.columns : []
    return {
      ...msg,
      columns: columns.map((col: any) => ({
        ...col,
        actions: Array.isArray(col?.actions) && col.actions.length > 0
          ? col.actions
          : [newCarouselAction()],
      })),
    }
  })
}

function validateMessages(messages: any[]): string | null {
  for (const msg of messages ?? []) {
    // text message optional buttons, but if a button exists it must be complete
    if (msg?.type === 'text' && Array.isArray(msg.buttons)) {
      for (const btn of msg.buttons) {
        if (!btn.label) return '文字模組：請輸入按鈕標題'
        if (btn.type === 'message' && !btn.text) return '文字模組：請輸入按鈕傳送文字'
        if (btn.type === 'uri' && !btn.uri) return '文字模組：請輸入按鈕網址'
        if (btn.type === 'module' && !btn.moduleId) return '文字模組：請選擇要觸發的機器人模組'
      }
    }

    // Validate quick replies
    if (msg?.type === 'quickReply') {
      if (!msg.text?.trim()) return '快速回覆模組：搭配的文字內容為必填'

      if (Array.isArray(msg.quickReplies)) {
        for (const qr of msg.quickReplies) {
          if (!qr.action?.label?.trim()) return '快速回覆：請輸入按鈕名稱'
          if (qr.action.type === 'message' && !qr.action?.text?.trim()) return '快速回覆：回覆文字不可為空'
          if (qr.action.type === 'uri' && !qr.action?.uri?.trim()) return '快速回覆：網址不可為空'
          if (qr.action.type === 'module' && !qr.action?.moduleId) return '快速回覆：請選擇要觸發的機器人模組'
        }
      }
    }

    // carousel buttons are required by design and must be complete
    if (msg?.type === 'carousel' && Array.isArray(msg.columns)) {
      for (const col of msg.columns) {
        for (const action of (col?.actions ?? [])) {
          if (!action?.label?.trim()) return '輪播按鈕文字為必填'
          if (action.type === 'uri' && !action?.uri?.trim()) return '輪播按鈕網址為必填'
          if (action.type === 'message' && !action?.text?.trim()) return '輪播按鈕傳送文字為必填'
          if (action.type === 'module' && !action?.moduleId) return '輪播：請選擇要觸發的機器人模組'
        }
      }
    }

    // image carousel action payload must be complete when action is enabled
    if (msg?.type === 'imageCarousel' && Array.isArray(msg.columns)) {
      for (const col of msg.columns) {
        const action = col?.action
        if (action?.type === 'uri') {
          if (!action?.label?.trim()) return '圖片輪播按鈕文字為必填'
          if (!action?.uri?.trim()) return '圖片輪播網址為必填'
        }
        if (action?.type === 'message') {
          if (!action?.label?.trim()) return '圖片輪播按鈕文字為必填'
          if (!action?.text?.trim()) return '圖片輪播傳送文字為必填'
        }
        if (action?.type === 'module') {
          if (!action?.label?.trim()) return '圖片輪播按鈕文字為必填'
          if (!action?.moduleId) return '圖片輪播：請選擇要觸發的機器人模組'
        }
      }
    }
  }
  return null
}
</script>


