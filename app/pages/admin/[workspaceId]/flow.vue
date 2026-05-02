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
        <AdminSplitListItem
          v-for="flow in flows"
          :key="flow.id"
          :title="(flow.isSystem ? '🔒 ' : '') + flow.name"
          :active="selectedId === flow.id"
          :meta-text="MODULE_TYPE_LABELS[flow.moduleType] ?? '機器人流程'"
          chip-tone="neutral"
          @select="selectFlow(flow)"
        />
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
      <AdminEditorHeaderTitle
        v-model="form.name"
        field-label="模組名稱"
        create-prefix="新增模組:"
        placeholder="請輸入模組名稱..."
        :caption="`共 ${form.messages.length} 則回覆訊息；關鍵字觸發請到「自動回覆」設定`"
        :is-creating="isCreating"
      />
      <div v-if="selectedFlow || isCreating" class="flow-module-meta">
        <el-tag v-if="isSystemFlow" type="warning" size="small" disable-transitions>🔒 系統模組</el-tag>
        <!-- System modules: type is locked, show label only -->
        <el-tag v-if="isSystemFlow" size="small" disable-transitions>
          {{ MODULE_TYPE_LABELS[form.moduleType] ?? '機器人流程' }}
        </el-tag>
        <!-- Regular modules (create or edit): show selector -->
        <el-select v-else v-model="form.moduleType" size="small" style="width: 130px">
          <el-option
            v-for="t in WORKSPACE_FLOW_MODULE_TYPES"
            :key="t"
            :label="MODULE_TYPE_LABELS[t]"
            :value="t"
          />
        </el-select>
      </div>
      <div class="flex gap-1 admin-header-actions">
        <el-button v-if="!isCreating && selectedFlow && !isSystemFlow" type="danger" @click="deleteFlow">
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
          <AdminPanelTitle tag="span" text="💬 回覆訊息" tight />
          <div class="msg-type-btns">
            <el-button size="small" @click="addMessage('text')">＋ 文字</el-button>
            <el-button size="small" @click="addMessage('image')">＋ 圖片</el-button>
            <el-button size="small" @click="addMessage('video')">＋ 影片</el-button>
            <el-button size="small" @click="addMessage('richMessage')">＋ 圖文訊息</el-button>
            <el-button size="small" @click="addMessage('carousel')">＋ 輪播</el-button>
            <el-button size="small" @click="addMessage('imageCarousel')">＋ 圖片輪播</el-button>
            <el-button size="small" @click="addMessage('quickReply')">＋ 快速回覆</el-button>
            <el-button size="small" @click="addMessage('userInput')">＋ 用戶輸入</el-button>
          </div>
        </div>

        <!-- Card rail (horizontal scroll) -->
        <div class="fem-rail">
          <div v-if="!form.messages.length" class="fem-empty">
            <span>尚無訊息</span>
            <p class="text-xs text-muted">點擊上方按鈕新增</p>
          </div>

          <!-- Message Cards + Carousel Blocks -->
          <template v-for="(msg, i) in form.messages" :key="getMessageRenderKey(msg, i)">

            <!-- ── Normal card: text / image / video ── -->
            <!-- Outer native div is the drop target; FlowMessageCardShell is drag source only -->
            <div
              v-if="msg.type === 'text' || msg.type === 'image' || msg.type === 'video' || msg.type === 'richMessageRef'"
              @dragover.prevent="onDragOver($event, i)"
              @dragenter.prevent
              @dragleave="onDragLeave"
              @drop="onDrop($event, i)"
            >
            <FlowMessageCardShell
              :badge-label="msgTypeLabel(msg.type)"
              :badge-class="msgBadgeClass(msg.type)"
              :class="{ dragging: dragIndex === i, 'drag-over': dragOverIndex === i && dragIndex !== i }"
              @dragstart="onDragStart($event, i)"
              @dragend="onDragEnd"
              @remove="removeMessage(i)"
            >
              <!-- Text -->
              <div v-if="msg.type === 'text'" class="message-bubble-wrap">
                <div class="admin-field-group">
                  <AdminFieldLabel tight>
                    回覆文字 <span class="text-muted">(最多 5000 字；若有按鈕最多 160 字)</span>
                  </AdminFieldLabel>
                  <div class="flow-textarea-wrapper flow-textarea-wrapper--var-inset">
                    <el-input v-model="msg.text" type="textarea" :rows="3" placeholder="輸入回覆文字..." :maxlength="msg.buttons && msg.buttons.length > 0 ? 160 : 5000" />
                    <FlowVariableInset
                      :options="variableTokenOptions"
                      @pick="(token) => insertVariableToken(msg, 'text', String(token))"
                    />
                  </div>
                </div>
                <div v-if="msg.buttons && msg.buttons.length" class="carousel-actions">
                  <div v-for="(btn, bIdx) in msg.buttons" :key="bIdx">
                    <FlowActionEditor
                      :action="btn"
                      :type-options="standardActionTypeOptions"
                      :module-options="flows"
                      :tag-options="allTags"
                      :enable-tagging="true"
                      :variable-options="variableTokenOptions"
                      :header-label="`按鈕 ${Number(bIdx) + 1}`"
                      label-placeholder="按鈕文字"
                      text-title="傳送文字"
                      text-placeholder="傳送文字"
                    >
                      <template #top-extra>
                        <el-button
                          link
                          type="danger"
                          size="small"
                          @click="removeButton(msg, Number(bIdx))"
                        >
                          ✕
                        </el-button>
                      </template>
                    </FlowActionEditor>
                  </div>
                </div>
                <el-button v-if="!msg.buttons || msg.buttons.length < 4" plain size="small" class="control-dashed-add" @click="addButton(msg)">
                  ⊕ 新增按鈕 (非必需)
                </el-button>
              </div>

              <!-- Image -->
              <div v-else-if="msg.type === 'image'" class="message-image-wrap">
                <div class="admin-field-group">
                  <AdminFieldLabel text="圖片" tight />
                  <FlowUploadZone v-model="msg.originalContentUrl" type="image" label="點擊上傳圖片" @update:model-value="(v) => { msg.previewImageUrl = v }" />
                </div>
              </div>

              <!-- Video -->
              <div v-else-if="msg.type === 'video'" class="message-video-wrap">
                <div class="admin-field-group">
                  <AdminFieldLabel>
                    預覽圖片 <span class="text-muted">(長寬大小與影片一樣)</span>
                  </AdminFieldLabel>
                  <FlowUploadZone v-model="msg.previewImageUrl" type="image" label="點擊上傳預覽圖" hint="建議與影片同尺寸" />
                </div>
                <div class="admin-field-group">
                  <AdminFieldLabel>
                    影片檔案 <span class="text-muted">(大小不可超過 5 MB)</span>
                  </AdminFieldLabel>
                  <FlowUploadZone v-model="msg.originalContentUrl" type="video" label="點擊上傳影片" hint="須符合 LINE 影片規範" />
                </div>
              </div>

              <!-- Rich Message Reference -->
              <div v-else-if="msg.type === 'richMessageRef'" class="message-bubble-wrap flow-rich-ref">
                <div class="admin-field-group">
                  <AdminFieldLabel text="引用圖文訊息" tight />
                  <el-select
                    v-model="msg.richMessageId"
                    size="small"
                    class="control-full"
                    filterable
                    placeholder="選擇已建立的圖文訊息"
                    @change="onRichMessageRefChange(msg)"
                  >
                    <el-option
                      v-for="item in richMessages"
                      :key="item.id"
                      :value="item.id"
                      :label="item.name"
                    />
                  </el-select>
                </div>
                <div class="text-xs text-muted">
                  圖文訊息需先在「圖文訊息管理」建立，這裡僅做引用。
                </div>
                <div v-if="richMessageRefPreview(msg)" class="carousel-action-row">
                  <div class="carousel-action-row-top">
                    <span class="carousel-action-index">預覽資訊</span>
                  </div>
                  <div class="text-sm">版型：{{ richMessageLayoutLabel(richMessageRefPreview(msg)?.layoutId || 'custom') }}</div>
                  <div class="text-xs text-muted">{{ richMessageRefPreview(msg)?.altText || '（未設定提醒文字）' }}</div>
                  <div class="text-xs text-muted">動作：{{ Array.isArray(richMessageRefPreview(msg)?.actions) ? richMessageRefPreview(msg)?.actions.length : 0 }} 個</div>
                </div>
              </div>
            </FlowMessageCardShell>
            </div>

            <!-- ── Rich Message (inline) block ── -->
            <div
              v-else-if="msg.type === 'richMessage'"
              class="carousel-block"
              :class="{ dragging: dragIndex === i, 'drag-over': dragOverIndex === i && dragIndex !== i }"
              @dragover.prevent="onDragOver($event, i)"
              @dragenter.prevent
              @dragleave="onDragLeave"
              @drop="onDrop($event, i)"
            >
              <!-- Config card -->
              <FlowMessageCardShell
                :badge-label="msgTypeLabel(msg.type)"
                :badge-class="msgBadgeClass(msg.type)"
                @dragstart="onDragStart($event, i)"
                @dragend="onDragEnd"
                @remove="removeMessage(i)"
              >
                <div class="card-section-stack">
                  <div class="admin-field-group">
                    <AdminFieldLabel tight>
                      提醒文字 <span class="text-muted">(最多 400 字)</span>
                    </AdminFieldLabel>
                    <el-input
                      v-model="msg.altText"
                      placeholder="提醒文字（最多 400 字）"
                      maxlength="400"
                    />
                  </div>
                  <div class="admin-field-group">
                    <AdminFieldLabel text="保留 PNG 透明區域" tight />
                    <div class="flow-rich-toggle-row">
                      <el-switch v-model="msg.transparentBackground" />
                      <span class="text-sm text-muted">開啟後保留透明像素</span>
                    </div>
                  </div>
                  <div class="admin-field-group">
                    <AdminFieldLabel text="背景圖片" tight />
                    <FlowUploadZone
                      v-model="msg.heroImageUrl"
                      type="image"
                      appearance="simple"
                      hint="JPG / PNG · 最大 500KB（建議 1040x1040）"
                    />
                  </div>
                  <AdminLayoutPresetPicker
                    flat
                    title="圖文樣式"
                    :layouts="RICH_LAYOUT_PRESETS"
                    :selected-id="msg.layoutId"
                    @select="(layoutId) => selectInlineRichMessageLayout(msg, String(layoutId))"
                  />
                  <FlowRichMessageAreas
                    v-if="String(msg.heroImageUrl || '').trim()"
                    :msg="msg"
                    :module-options="flows"
                    :tag-options="allTags"
                    :enable-tagging="true"
                    :show-canvas="true"
                    :show-action-cards="false"
                    :show-header="false"
                    :flat="true"
                  />
                </div>
              </FlowMessageCardShell>
              <FlowRichMessageAreas
                v-if="String(msg.heroImageUrl || '').trim()"
                :msg="msg"
                :module-options="flows"
                :tag-options="allTags"
                :enable-tagging="true"
                :show-canvas="false"
                :show-action-cards="true"
                :flat="true"
              />
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
              <FlowMessageCardShell
                badge-label="⚡ 快速回覆"
                badge-class="badge-purple"
                @dragstart="onDragStart($event, i)"
                @dragend="onDragEnd"
                @remove="removeMessage(i)"
              >
                <!-- Text input for the bubble! -->
                <div class="carousel-alt-wrap card-section-stack">
                  <div class="admin-field-group">
                    <AdminFieldLabel tight>
                      搭配的文字內容 <span class="text-muted">(必需輸入，最多 5000 字)</span>
                    </AdminFieldLabel>
                    <div class="flow-textarea-wrapper flow-textarea-wrapper--var-inset">
                      <el-input
                        v-model="msg.text"
                        type="textarea"
                        :rows="2"
                        placeholder="請輸入主要回覆文字..."
                        maxlength="5000"
                      />
                      <FlowVariableInset
                        :options="variableTokenOptions"
                        @pick="(token) => insertVariableToken(msg, 'text', String(token))"
                      />
                    </div>
                  </div>
                </div>
              </FlowMessageCardShell>

              <!-- Sub-card horizontal rail ── -->
              <div class="carousel-cards-scroll cards-scroll-top-gap">
                <div
                  v-for="(qr, qi) in msg.quickReplies" :key="qi"
                  class="carousel-sub-card"
                  :class="{ 'col-dragging': qrDragMsgIndex === i && qrDragIndex === qi, 'col-drag-over': qrDragMsgIndex === i && qrDragOverIndex === qi && qrDragIndex !== qi }"
                  @dragover.prevent="onQrDragOver($event, i, Number(qi))"
                  @dragenter.prevent
                  @dragleave="onQrDragLeave"
                  @drop="onQrDrop($event, i, Number(qi))"
                >
                  <div class="carousel-card-top">
                    <div class="flex gap-1 items-center">
                      <span class="drag-handle" draggable="true" @dragstart.stop="onQrDragStart($event, i, Number(qi))" @dragend.stop="onQrDragEnd">⠿</span>
                      <span class="carousel-card-idx">{{ Number(qi) + 1 }}</span>
                    </div>
                    <el-button link type="danger" size="small" @click="removeQuickReply(msg, Number(qi))">✕</el-button>
                  </div>
                  <div class="carousel-sub-body carousel-sub-body-top-gap">
                    <!-- Action Config -->
                      <div class="carousel-actions">
                      <FlowActionEditor
                        :action="qr.action"
                        :type-options="quickReplyActionTypeOptions"
                        :module-options="flows"
                        :tag-options="allTags"
                        :enable-tagging="true"
                        :variable-options="variableTokenOptions"
                        header-label="按鈕動作"
                        label-title="按鈕顯示文字（最多 20 字）"
                      />
                    </div>
                  </div>
                </div>

                <!-- Add Button -->
                <button v-if="!msg.quickReplies || msg.quickReplies.length < 13" class="carousel-add-card" @click="addQuickReply(msg)">
                  <span class="add-card-plus">＋</span>
                </button>
              </div>
            </div>

            <!-- ── User Input block ── -->
            <!-- Outer native div is the drop target; FlowMessageCardShell is drag source only -->
            <div
              v-else-if="msg.type === 'userInput'"
              @dragover.prevent="onDragOver($event, i)"
              @dragenter.prevent
              @dragleave="onDragLeave"
              @drop="onDrop($event, i)"
            >
            <FlowMessageCardShell
              class="user-input-card"
              :badge-label="msgTypeLabel(msg.type)"
              :badge-class="msgBadgeClass(msg.type)"
              :class="{ dragging: dragIndex === i, 'drag-over': dragOverIndex === i && dragIndex !== i }"
              @dragstart="onDragStart($event, i)"
              @dragend="onDragEnd"
              @remove="removeMessage(i)"
            >
              <div class="message-bubble-wrap user-input-content">
                <div class="ui-field admin-field-group">
                  <AdminFieldLabel tight>
                    向用戶提問 <span class="text-muted">(必填，最多 500 字)</span>
                  </AdminFieldLabel>
                  <div class="flow-textarea-wrapper flow-textarea-wrapper--var-inset flow-textarea-wrapper--no-resize">
                    <el-input
                      v-model="msg.text"
                      type="textarea"
                      :rows="3"
                      placeholder="請輸入你的問題 (必需輸入)"
                      maxlength="500"
                      resize="none"
                    />
                    <FlowVariableInset
                      :options="variableTokenOptions"
                      @pick="(token) => insertVariableToken(msg, 'text', String(token))"
                    />
                  </div>
                </div>

                <div class="ui-settings">
                  <div class="ui-field admin-field-group">
                    <AdminFieldLabel tight>
                      儲存屬性名稱 <span class="text-muted">(選填)</span>
                    </AdminFieldLabel>
                    <el-select
                      v-model="msg.attribute"
                      size="small"
                      class="control-full"
                      filterable
                      allow-create
                      clearable
                      default-first-option
                      placeholder="選擇或輸入屬性名稱（例：phone, email）"
                    >
                      <el-option
                        v-for="opt in attributeOptions"
                        :key="opt.value"
                        :value="opt.value"
                        :label="opt.label"
                      />
                    </el-select>
                  </div>

                  <div class="ui-field admin-field-group">
                    <AdminFieldLabel tight>
                      收到回覆後，觸發下一個模組 <span class="text-muted">(必填)</span>
                    </AdminFieldLabel>
                    <el-select v-model="msg.moduleId" placeholder="選擇機器人模組" size="small" class="control-full">
                      <el-option v-for="f in flows" :key="f.id" :value="f.id" :label="f.name" />
                    </el-select>
                  </div>
                  <div class="ui-field admin-field-group">
                    <AdminFieldLabel text="收到回覆後是否貼標" tight />
                    <el-switch
                      v-model="msg.tagging.enabled"
                      active-text="啟用"
                      inactive-text="停用"
                      class="ar-status-switch"
                    />
                  </div>
                  <div v-if="msg.tagging.enabled" class="ui-field admin-field-group">
                    <AdminFieldLabel text="命中後加上標籤" tight />
                    <el-select
                      v-model="msg.tagging.addTagIds"
                      multiple
                      collapse-tags
                      collapse-tags-tooltip
                      placeholder="選擇要貼的標籤"
                      class="control-full"
                    >
                      <el-option
                        v-for="tag in allTags"
                        :key="tag.id"
                        :value="tag.id"
                        :label="tag.name"
                      >
                        <AdminTagOptionRow :label="tag.name" :color="tag.color" />
                      </el-option>
                    </el-select>
                  </div>
                </div>

                <div class="ui-warning-text">
                  用戶在聊天室看到這則提問後輸入回覆，系統會在 24 小時內把回覆存成你設定的屬性（若有填寫），並自動觸發你選擇的下一個模組。注意：超過 24 小時後，則不會觸發下一個行動，也不會將回覆存為自訂屬性。
                </div>
              </div>
            </FlowMessageCardShell>
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
              <FlowMessageCardShell
                :badge-label="msgTypeLabel(msg.type)"
                :badge-class="msgBadgeClass(msg.type)"
                @dragstart="onDragStart($event, i)"
                @dragend="onDragEnd"
                @remove="removeMessage(i)"
              >
                <!-- Alt Text body (reusing standard padding) -->
                <div class="carousel-alt-wrap card-section-stack">
                  <div class="admin-field-group">
                    <AdminFieldLabel tight>
                      訊息提醒文字 <span class="text-muted">(最多 400 字)</span>
                    </AdminFieldLabel>
                    <div class="flow-input-inset-wrap control-full">
                      <el-input
                        v-model="msg.altText"
                        :placeholder="msg.type === 'imageCarousel' ? '訊息提醒文字（最多 400 字）' : '訊息提醒文字（不支援 Flex 時顯示，最多 400 字）'"
                        maxlength="400"
                      />
                      <FlowVariableInset
                        :options="variableTokenOptions"
                        @pick="(token) => insertVariableToken(msg, 'altText', String(token))"
                      />
                    </div>
                  </div>
                  <div v-if="msg.type === 'imageCarousel'" class="text-xs text-muted">
                    圖片長度不可超過寬度的 3 倍，小於 500 KB，建議每張比例相同
                  </div>
                </div>
              </FlowMessageCardShell>

              <!-- 2. Horizontal sub-card rail ── -->
              <div class="carousel-cards-scroll cards-scroll-top-gap">

                <!-- Carousel sub-cards -->
                <template v-if="msg.type === 'carousel'">
                  <div
                    v-for="(col, ci) in msg.columns" :key="ci"
                    class="carousel-sub-card"
                    :class="{ 'col-dragging': colDragMsgIndex === i && colDragIndex === ci, 'col-drag-over': colDragMsgIndex === i && colDragOverIndex === ci && colDragIndex !== ci }"
                    @dragover.prevent="onColDragOver($event, i, Number(ci))"
                    @dragenter.prevent
                    @dragleave="onColDragLeave"
                    @drop="onColDrop($event, i, Number(ci))"
                  >
                    <div class="carousel-card-top">
                      <div class="flex gap-1 items-center">
                        <span class="drag-handle" draggable="true" @dragstart.stop="onColDragStart($event, i, Number(ci))" @dragend.stop="onColDragEnd">⠿</span>
                        <span class="carousel-card-idx">{{ Number(ci) + 1 }}</span>
                      </div>
                      <el-button v-if="msg.columns.length > 1" link type="danger" size="small" @click="msg.columns.splice(Number(ci), 1)">✕</el-button>
                    </div>
                    <div class="carousel-sub-body admin-field-stack">
                      <FlowUploadZone v-model="col.thumbnailImageUrl" type="image" label="上傳縮圖" preview-height="140px" />
                      <div class="admin-field-group">
                        <AdminFieldLabel tight>
                          標題 <span class="text-muted">(必填，最多 80 字)</span>
                        </AdminFieldLabel>
                        <div class="flow-input-inset-wrap flow-input-inset-wrap--sm control-full">
                          <el-input v-model="col.title" placeholder="標題（必填，最多 80 字）" maxlength="80" />
                          <FlowVariableInset
                            size="sm"
                            :options="variableTokenOptions"
                            @pick="(token) => insertVariableToken(col, 'title', String(token))"
                          />
                        </div>
                      </div>
                      <div class="admin-field-group">
                        <AdminFieldLabel tight>
                          內容 <span class="text-muted">(最多 300 字)</span>
                        </AdminFieldLabel>
                        <div class="flow-textarea-wrapper flow-textarea-wrapper--var-inset">
                          <el-input v-model="col.text" type="textarea" :rows="2" placeholder="副標題或內容（最多 300 字）" maxlength="300" />
                          <FlowVariableInset
                            :options="variableTokenOptions"
                            @pick="(token) => insertVariableToken(col, 'text', String(token))"
                          />
                        </div>
                      </div>
                      <div v-if="col.actions?.length" class="carousel-actions">
                        <div v-for="(act, ai) in col.actions" :key="ai">
                          <FlowActionEditor
                            :action="act"
                            :type-options="standardActionTypeOptions"
                            :module-options="flows"
                            :tag-options="allTags"
                            :enable-tagging="true"
                            :variable-options="variableTokenOptions"
                            :header-label="`按鈕 ${Number(ai) + 1}`"
                            :field-size="'default'"
                            label-placeholder="按鈕文字"
                            text-title="傳送文字"
                            text-placeholder="傳送文字"
                          >
                            <template #top-extra>
                              <el-button
                                link
                                type="danger"
                                size="small"
                                :disabled="col.actions.length <= 1"
                                @click="removeCarouselAction(col, Number(ai))"
                              >
                                ✕
                              </el-button>
                            </template>
                          </FlowActionEditor>
                        </div>
                      </div>
                      <el-button v-if="!col.actions || col.actions.length < 3" plain size="small" class="control-dashed-add" @click="addCarouselAction(col)">⊕ 新增按鈕</el-button>
                    </div>
                  </div>
                </template>

                <!-- imageCarousel sub-cards -->
                <template v-else>
                  <div
                    v-for="(col, ci) in msg.columns" :key="ci"
                    class="carousel-sub-card"
                    :class="{ 'col-dragging': colDragMsgIndex === i && colDragIndex === ci, 'col-drag-over': colDragMsgIndex === i && colDragOverIndex === ci && colDragIndex !== ci }"
                    @dragover.prevent="onColDragOver($event, i, Number(ci))"
                    @dragenter.prevent
                    @dragleave="onColDragLeave"
                    @drop="onColDrop($event, i, Number(ci))"
                  >
                    <div class="carousel-card-top">
                      <div class="flex gap-1 items-center">
                        <span class="drag-handle" draggable="true" @dragstart.stop="onColDragStart($event, i, Number(ci))" @dragend.stop="onColDragEnd">⠿</span>
                        <span class="carousel-card-idx">{{ Number(ci) + 1 }}</span>
                      </div>
                      <el-button v-if="msg.columns.length > 1" link type="danger" size="small" @click="msg.columns.splice(Number(ci), 1)">✕</el-button>
                    </div>
                    <div class="carousel-sub-body">
                      <FlowUploadZone v-model="col.imageUrl" type="image" label="上傳" preview-height="160px" />
                      <div class="carousel-actions carousel-actions-top-gap">
                        <FlowActionEditor
                          :action="col.action"
                          :type-options="imageCarouselActionTypeOptions"
                          :module-options="flows"
                          :tag-options="allTags"
                          :enable-tagging="true"
                          :variable-options="variableTokenOptions"
                          header-label="圖片動作"
                          :field-size="'default'"
                          :hide-fields-when-none="true"
                          label-placeholder="按鈕文字 (必填)"
                          text-title="傳送文字"
                          text-placeholder="點擊後傳送的文字"
                        />
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
                  <span class="add-card-plus">＋</span>
                </button>
              </div>
            </div>

          </template>
          <!-- End rail -->
          </div>
        </div>

    </template>
  </AdminSplitLayout>

  <AdminToastStack :toasts="toasts" />
</template>


<script setup lang="ts">
import {
  SLOT_LABELS as ACTION_SLOT_LABELS,
  validateUnifiedAction,
} from '~~/shared/action-schema'
import {
  RICH_LAYOUT_PRESETS,
  type RichLayoutId,
} from '~~/shared/rich-layout-presets'
import {
  createRichMessageActions,
  normalizeRichMessageActions,
  richMessageEditorActionsOverlap,
  RICH_MESSAGE_MIN_BOUNDS,
} from '~~/shared/rich-message-editor-helpers'
import {
  MODULE_TYPE_LABELS,
  WORKSPACE_FLOW_MODULE_TYPES,
  type ModuleType,
} from '~~/shared/types/conversation-stats'

definePageMeta({ middleware: 'auth', layout: 'default' })

const { apiFetch } = useWorkspace()

// ── State ─────────────────────────────────────────────
const flows = ref<any[]>([])
const richMessages = ref<any[]>([])
const loading = ref(true)
const saving = ref(false)
const seeding = ref(false)
const selectedId = ref<string | null>(null)
const isCreating = ref(false)
const FLOW_MESSAGE_LIMIT = 5
const { toasts, showToast } = useAdminToast()
const { tags: allTags, loadTags } = useAdminTagList()

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

const messageRenderKeys = new WeakMap<object, string>()
let messageRenderKeySeq = 0

function getMessageRenderKey(msg: any, index: number) {
  if (msg && typeof msg === 'object') {
    const target = msg as object
    let key = messageRenderKeys.get(target)
    if (!key) {
      key = `msg-${messageRenderKeySeq++}`
      messageRenderKeys.set(target, key)
    }
    return key
  }
  return `msg-fallback-${index}`
}

function resolveDraggedIndex(e: DragEvent, fallback: number | null) {
  if (fallback !== null) return fallback
  const raw = e.dataTransfer?.getData('text/plain')
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) ? parsed : null
}

const defaultForm = () => ({
  name: '',
  messages: [] as any[],
  moduleType: 'bot_flow' as ModuleType,
})
const form = ref(defaultForm())

const selectedFlow = computed(() => flows.value.find(f => f.id === selectedId.value) ?? null)
const isSystemFlow = computed(() => selectedFlow.value?.isSystem === true)
const BUILTIN_VARIABLE_LABELS: Record<string, string> = {
  displayName: '聯絡人名稱（使用者名字）',
}
const attributeOptions = computed(() => {
  const values = new Set<string>()

  const collectAttributes = (messages: any[]) => {
    for (const msg of (messages ?? [])) {
      const rawAttr = msg?.type === 'userInput' ? msg?.attribute : ''
      const attr = typeof rawAttr === 'string' ? rawAttr.trim() : ''
      if (attr) values.add(attr)
    }
  }

  collectAttributes(form.value.messages)
  for (const flow of flows.value) {
    collectAttributes(flow?.messages ?? [])
  }

  return Array.from(values).map((value) => ({
    value,
    label: value,
  }))
})
const variableTokenOptions = computed(() => {
  const values = new Set<string>(['displayName'])

  const collectAttributes = (messages: any[]) => {
    for (const msg of (messages ?? [])) {
      const rawAttr = msg?.type === 'userInput' ? msg?.attribute : ''
      const attr = typeof rawAttr === 'string' ? rawAttr.trim() : ''
      if (attr) values.add(attr)
    }
  }

  collectAttributes(form.value.messages)
  for (const flow of flows.value) {
    collectAttributes(flow?.messages ?? [])
  }

  return Array.from(values).map((value) => ({
    value,
    label: BUILTIN_VARIABLE_LABELS[value] ?? value,
    token: `{{${value}}}`,
  }))
})

function insertVariableToken(target: Record<string, any>, key: string, token: string) {
  const current = typeof target[key] === 'string' ? target[key] : ''
  target[key] = `${current}${token}`
}

// ── Badge helpers ─────────────────────────────────────
const MSG_META: Record<string, { label: string; badge: string }> = {
  text:          { label: '📝 文字訊息',  badge: 'badge-blue'   },
  image:         { label: '🖼️ 圖片訊息', badge: 'badge-orange' },
  video:         { label: '🎬 影片訊息', badge: 'badge-gray'   },
  richMessage:   { label: '📰 圖文訊息', badge: 'badge-green'  },
  richMessageRef:{ label: '📰 圖文訊息(舊)', badge: 'badge-green'  },
  carousel:      { label: '🎠 輪播訊息', badge: 'badge-green'  },
  imageCarousel: { label: '🖼️ 圖片輪播', badge: 'badge-gray'  },
  quickReply:    { label: '⚡ 快速回覆', badge: 'badge-purple' },
  userInput:     { label: '✍️ 用戶輸入卡片', badge: 'badge-red' },
}

const standardActionTypeOptions = [
  { value: 'uri', label: '開網址' },
  { value: 'message', label: '傳文字' },
  { value: 'module', label: '觸發模組' },
]

const quickReplyActionTypeOptions = [
  { value: 'message', label: '傳送文字' },
  { value: 'uri', label: '開啟網址' },
  { value: 'module', label: '觸發模組' },
]

const imageCarouselActionTypeOptions = [
  { value: 'none', label: '未有行動' },
  { value: 'uri', label: '開啟網址' },
  { value: 'message', label: '傳送文字' },
  { value: 'module', label: '觸發模組' },
]

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
  flows.value = await apiFetch<any[]>('/api/flow/list').catch(() => [])
  loading.value = false
}
async function loadRichMessages() {
  const list = await apiFetch<any[]>('/api/rich-message/list').catch(() => [])
  richMessages.value = (list ?? []).map((item) => normalizeRichMessageItem(item))
  form.value.messages = normalizeMessages(form.value.messages)
}

onMounted(async () => {
  await Promise.all([loadFlows(), loadRichMessages(), loadTags({ status: 'active' })])
})

// ── Select / Create ───────────────────────────────────
function normalizeWorkspaceModuleType(raw: ModuleType | undefined): ModuleType {
  return raw === 'system_notice' ? 'system_notice' : 'bot_flow'
}

function selectFlow(flow: any) {
  isCreating.value = false
  selectedId.value = flow.id
  const rawType = (flow.moduleType ?? 'bot_flow') as ModuleType
  form.value = {
    name: flow.name,
    messages: normalizeMessages(JSON.parse(JSON.stringify(flow.messages ?? []))),
    moduleType: flow.isSystem ? rawType : normalizeWorkspaceModuleType(rawType),
  }
}

async function seedSystemModules() {
  seeding.value = true
  try {
    const res = await apiFetch<{ results: { id: string; created: boolean }[] }>(
      '/api/admin/seed-system-modules',
      { method: 'POST' },
    )
    const created = res.results.filter(r => r.created).map(r => r.id)
    if (created.length) {
      showToast(`已建立系統模組：${created.join('、')}`, 'success')
    } else {
      showToast('系統模組已存在，無需重建', 'success')
    }
    await loadFlows()
  } catch {
    showToast('初始化失敗', 'error')
  } finally {
    seeding.value = false
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
  if (form.value.messages.length >= FLOW_MESSAGE_LIMIT) {
    showToast(`單一模組最多只能儲存 ${FLOW_MESSAGE_LIMIT} 則訊息`, 'error')
    return
  }

  if (type === 'text') {
    form.value.messages.push({ type: 'text', text: '', buttons: [] })
  } else if (type === 'image') {
    form.value.messages.push({ type: 'image', originalContentUrl: '', previewImageUrl: '' })
  } else if (type === 'video') {
    form.value.messages.push({ type: 'video', originalContentUrl: '', previewImageUrl: '' })
  } else if (type === 'richMessage') {
    form.value.messages.push({
      type: 'richMessage',
      altText: '',
      transparentBackground: false,
      heroImageUrl: '',
      layoutId: 'single' as RichLayoutId,
      actions: createRichMessageActions('single'),
    })
  } else if (type === 'richMessageRef') {
    form.value.messages.push({
      type: 'richMessageRef',
      richMessageId: '',
      richMessageName: '',
    })
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
    const existingIndex = form.value.messages.findIndex(m => m.type === 'quickReply' || m.type === 'userInput')
    if (existingIndex > -1) {
      showToast('每個流程只能有一張「快速回覆」或「用戶輸入卡片」', 'error')
      return
    }
    form.value.messages.push({
      type: 'quickReply',
      text: '',
      quickReplies: [newQuickReplyAction()]
    })
  } else if (type === 'userInput') {
    const existingIndex = form.value.messages.findIndex(m => m.type === 'quickReply' || m.type === 'userInput')
    if (existingIndex > -1) {
      showToast('每個流程只能有一張「快速回覆」或「用戶輸入卡片」', 'error')
      return
    }
    form.value.messages.push({
      type: 'userInput',
      text: '',
      attribute: '',
      moduleId: '',
      tagging: { enabled: false, addTagIds: [] },
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
  return { type: 'uri', label: '', uri: '', text: '', moduleId: '', tagging: { enabled: false, addTagIds: [] } }
}

function newImageCarouselColumn() {
  return {
    imageUrl: '',
    action: { type: 'none', uri: '', text: '', label: '', moduleId: '', tagging: { enabled: false, addTagIds: [] } },
  }
}

function newQuickReplyAction() {
  return { imageUrl: '', action: { type: 'message', label: '', text: '', moduleId: '', tagging: { enabled: false, addTagIds: [] } } }
}

function normalizeRichMessageItem(item: any) {
  const layoutId = typeof item?.layoutId === 'string' ? item.layoutId : 'custom'
  const actions = Array.isArray(item?.actions)
    ? item.actions
    : Array.isArray(item?.buttons)
      ? item.buttons.map((btn: any, index: number) => ({
          slot: ACTION_SLOT_LABELS[index] || String.fromCharCode(65 + index),
          type: btn?.type === 'message' || btn?.type === 'module' ? btn.type : 'uri',
          uri: btn?.uri || '',
          text: btn?.text || '',
          moduleId: btn?.moduleId || '',
          tagging: {
            enabled: btn?.tagging?.enabled === true,
            addTagIds: Array.isArray(btn?.tagging?.addTagIds) ? btn.tagging.addTagIds : [],
          },
        }))
      : []
  return {
    id: item?.id || '',
    name: item?.name || '',
    layoutId,
    transparentBackground: Boolean(item?.transparentBackground),
    altText: item?.altText || '',
    heroImageUrl: item?.heroImageUrl || '',
    actions: actions.map((action: any, idx: number) => ({
      slot: action?.slot || ACTION_SLOT_LABELS[idx] || String.fromCharCode(65 + idx),
      type: action?.type === 'message' || action?.type === 'module' ? action.type : 'uri',
      uri: action?.uri || '',
      text: action?.text || '',
      moduleId: action?.moduleId || '',
    })),
  }
}

function richMessageLayoutLabel(layoutId: string) {
  const labels: Record<string, string> = {
    custom: '自訂',
    single: '滿版',
    splitV: '左右',
    splitH: '上下',
    grid4: '四宮格',
    tripleH: '三橫列',
    mix3: '上1下2',
    grid6: '六宮格',
  }
  return labels[layoutId] || '自訂'
}

function syncRichMessagePayload(msg: any) {
  const selected = richMessages.value.find(item => item.id === msg.richMessageId)
  if (!selected) {
    msg.richMessageName = ''
    return
  }
  msg.richMessageName = selected.name || ''
}

function onRichMessageRefChange(msg: any) {
  syncRichMessagePayload(msg)
}

function selectInlineRichMessageLayout(msg: any, layoutId: string) {
  const nextLayout = layoutId as RichLayoutId
  if (msg.layoutId === nextLayout) return
  msg.layoutId = nextLayout
  msg.actions = normalizeRichMessageActions(nextLayout, msg.actions || [])
}

function richMessageRefPreview(msg: any) {
  const selected = richMessages.value.find(item => item.id === msg?.richMessageId)
  if (selected) return selected
  return msg?.payload ? normalizeRichMessageItem(msg.payload) : null
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
  msg.buttons.push({ type: 'message', label: '', text: '', uri: '', moduleId: '', tagging: { enabled: false, addTagIds: [] } })
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
  // dataTransfer must be set synchronously inside dragstart
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.dropEffect = 'move'
    e.dataTransfer.setData('text/plain', i.toString())
  }
  // Delay the Vue reactive update that adds `dragging` class (with CSS transform).
  // Setting dragIndex.value synchronously triggers a Vue re-render which applies
  // transform: scale(0.98) to .carousel-block (align-self:stretch + overflow-x:auto).
  // Chrome detects this layout change mid-dragstart and cancels the drag operation.
  // Deferring to rAF ensures Chrome commits the drag before any DOM mutation occurs.
  requestAnimationFrame(() => {
    dragIndex.value = i
  })
}

function onDragEnd() {
  dragIndex.value = null
  dragOverIndex.value = null
}

function onDragOver(_e: DragEvent, i: number) {
  if (dragIndex.value !== null) {
    dragOverIndex.value = i
  }
}


function onDragLeave() {
  dragOverIndex.value = null
}

function onDrop(e: DragEvent, dropIndex: number) {
  e.preventDefault()
  if (dragIndex.value === null) return
  const fromIndex = resolveDraggedIndex(e, dragIndex.value)
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
  e.preventDefault()
  if (colDragMsgIndex.value === null) return  // card-level drag: let event bubble to carousel-block
  e.stopPropagation()
  const fromIndex = resolveDraggedIndex(e, colDragIndex.value)
  if (colDragMsgIndex.value === msgIndex && fromIndex !== null && fromIndex !== dropIndex) {
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
  e.preventDefault()
  if (qrDragMsgIndex.value === null) return  // card-level drag: let event bubble to outer block
  e.stopPropagation()
  const fromIndex = resolveDraggedIndex(e, qrDragIndex.value)
  if (qrDragMsgIndex.value === msgIndex && fromIndex !== null && fromIndex !== dropIndex) {
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
  if (form.value.messages.length > FLOW_MESSAGE_LIMIT) {
    return showToast(`單一模組最多只能儲存 ${FLOW_MESSAGE_LIMIT} 則訊息`, 'error')
  }

  form.value.messages = normalizeMessages(form.value.messages)
  const validationError = validateMessages(form.value.messages)
  if (validationError) return showToast(validationError, 'error')

  saving.value = true
  try {
    if (isCreating.value) {
      const res = await apiFetch<any>('/api/flow/create', {
        method: 'POST',
        body: {
          name: form.value.name,
          messages: form.value.messages,
          isActive: true,
          moduleType: form.value.moduleType,
        },
      })
      showToast('模組已建立 ✅', 'success')
      await loadFlows()
      const newFlow = flows.value.find(f => f.id === res.id) ?? flows.value[0]
      if (newFlow) selectFlow(newFlow)
      isCreating.value = false
    } else {
      await apiFetch(`/api/flow/${selectedId.value}`, {
        method: 'PUT',
        body: {
          name: form.value.name,
          messages: form.value.messages,
          isActive: true,
          // Only allow moduleType change for non-system flows
          ...(!isSystemFlow.value ? { moduleType: form.value.moduleType } : {}),
        },
      })
      showToast('模組已更新 ✅', 'success')
      await loadFlows()
    }
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '儲存失敗', 'error')
  } finally {
    saving.value = false
  }
}

async function deleteFlow() {
  if (!selectedId.value || !confirm(`確定刪除「${form.value.name}」？`)) return
  try {
    await apiFetch(`/api/flow/${selectedId.value}`, { method: 'DELETE' })
    showToast('已刪除', 'success')
    selectedId.value = null
    form.value = defaultForm()
    await loadFlows()
  } catch {
    showToast('刪除失敗', 'error')
  }
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

    if (msg.type === 'userInput') {
      return {
        ...msg,
        text: msg.text || '',
        attribute: msg.attribute || '',
        moduleId: msg.moduleId || '',
        tagging: {
          enabled: msg?.tagging?.enabled === true,
          addTagIds: Array.isArray(msg?.tagging?.addTagIds)
            ? msg.tagging.addTagIds.map((v: unknown) => String(v || '').trim()).filter(Boolean)
            : [],
        },
      }
    }

    if (msg.type === 'richMessage') {
      const rawLayout = (msg.layoutId as string) || 'single'
      const layoutId = RICH_LAYOUT_PRESETS.some((p) => p.id === rawLayout)
        ? (rawLayout as RichLayoutId)
        : 'single'
      return {
        ...msg,
        altText: msg.altText || '',
        transparentBackground: Boolean(msg.transparentBackground),
        heroImageUrl: msg.heroImageUrl || '',
        layoutId,
        actions: normalizeRichMessageActions(
          layoutId,
          Array.isArray(msg.actions) && msg.actions.length > 0
            ? msg.actions
            : createRichMessageActions(layoutId),
        ),
      }
    }

    if (msg.type === 'richMessageRef') {
      const selected = richMessages.value.find(item => item.id === msg.richMessageId)
      const { payload: _legacyPayload, ...rest } = msg || {}
      return {
        ...rest,
        richMessageId: msg.richMessageId || '',
        richMessageName: msg.richMessageName || selected?.name || '',
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
  if (messages.length > FLOW_MESSAGE_LIMIT) return `單一模組最多只能儲存 ${FLOW_MESSAGE_LIMIT} 則訊息`

  const qrCount = messages.filter((m: any) => m.type === 'quickReply').length
  const uiCount = messages.filter((m: any) => m.type === 'userInput').length

  if (qrCount > 1) return '快速回覆模組：每個流程只能有一個'
  if (uiCount > 1) return '用戶輸入卡片：每個流程只能有一張'
  if (qrCount > 0 && uiCount > 0) return '不能同時設定「快速回覆」與「用戶輸入卡片」'

  const lastMsg = messages[messages.length - 1]
  if (uiCount > 0 && lastMsg?.type !== 'userInput') return '用戶輸入卡片必須放在所有訊息的最結尾'

  for (const msg of messages ?? []) {
    // text message optional buttons, but if a button exists it must be complete
    if (msg?.type === 'text' && Array.isArray(msg.buttons)) {
      for (const btn of msg.buttons) {
        if (!btn.label) return '文字模組：請輸入按鈕標題'
        if (btn.type === 'message' && !btn.text) return '文字模組：請輸入按鈕傳送文字'
        if (btn.type === 'uri' && !btn.uri) return '文字模組：請輸入按鈕網址'
        if (btn.type === 'module' && !btn.moduleId) return '文字模組：請選擇要觸發的機器人模組'
        if (btn?.tagging?.enabled === true && (!Array.isArray(btn?.tagging?.addTagIds) || btn.tagging.addTagIds.length === 0)) {
          return '文字模組：已啟用貼標，請至少選擇一個標籤'
        }
      }
    }

    // Validate quick replies
    if (msg?.type === 'quickReply') {
      if (!msg.text?.trim()) return '快速回覆模組：搭配的文字內容為必填'
      if (!Array.isArray(msg.quickReplies) || msg.quickReplies.length < 1) {
        return '快速回覆模組：至少要有 1 個快速回覆選項'
      }
      if (msg.quickReplies.length > 13) return '快速回覆模組：最多 13 個快速回覆選項'

      if (Array.isArray(msg.quickReplies)) {
        for (const qr of msg.quickReplies) {
          if (!qr.action?.label?.trim()) return '快速回覆：請輸入按鈕名稱'
          if (qr.action.type === 'message' && !qr.action?.text?.trim()) return '快速回覆：回覆文字不可為空'
          if (qr.action.type === 'uri' && !qr.action?.uri?.trim()) return '快速回覆：網址不可為空'
          if (qr.action.type === 'module' && !qr.action?.moduleId) return '快速回覆：請選擇要觸發的機器人模組'
          if (qr.action?.tagging?.enabled === true && (!Array.isArray(qr.action?.tagging?.addTagIds) || qr.action.tagging.addTagIds.length === 0)) {
            return '快速回覆：已啟用貼標，請至少選擇一個標籤'
          }
        }
      }
    }

    if (msg?.type === 'userInput') {
      if (!msg.text?.trim()) return '用戶輸入卡片：請輸入你的問題'
      if (msg.attribute?.trim() && !/^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(msg.attribute.trim())) {
        return '用戶輸入卡片：儲存屬性名稱格式錯誤，請使用英文字母開頭，且只能包含英數與底線'
      }
      if (!msg.moduleId) return '用戶輸入卡片：請選擇等待回覆後要觸發的下一個模組'
      if (msg?.tagging?.enabled === true && (!Array.isArray(msg?.tagging?.addTagIds) || msg.tagging.addTagIds.length === 0)) {
        return '用戶輸入卡片：已啟用貼標，請至少選擇一個標籤'
      }
    }

    if (msg?.type === 'richMessage') {
      if (!msg.altText?.trim()) return '圖文訊息：請輸入提醒文字（Alt Text）'
      if (!msg.heroImageUrl) return '圖文訊息：請上傳背景圖片'
      if (!Array.isArray(msg.actions) || msg.actions.length < 1) return '圖文訊息：尚未設定任何動作區塊'
      if (msg.layoutId === 'custom') {
        if (richMessageEditorActionsOverlap(msg.actions)) {
          return '圖文訊息：自訂區域有重疊，請調整後再儲存'
        }
        for (const action of msg.actions) {
          const bounds = action.bounds
          if (!bounds) return `圖文訊息：區塊 ${action.slot} 缺少自訂區域範圍`
          if (bounds.width < RICH_MESSAGE_MIN_BOUNDS || bounds.height < RICH_MESSAGE_MIN_BOUNDS) {
            return `圖文訊息：區塊 ${action.slot} 區域尺寸過小`
          }
        }
      }
      for (const action of msg.actions) {
        const error = validateUnifiedAction({
          slot: action.slot || '',
          type: action.type === 'message' || action.type === 'module' ? action.type : 'uri',
          uri: action.uri || '',
          text: action.text || '',
          moduleId: action.moduleId || '',
          tagging: {
            enabled: action?.tagging?.enabled === true,
            addTagIds: Array.isArray(action?.tagging?.addTagIds) ? action.tagging.addTagIds : [],
          },
        })
        if (error) return `圖文訊息：區塊 ${action.slot} ${error}`
      }
    }

    if (msg?.type === 'richMessageRef') {
      if (!msg.richMessageId) return '圖文訊息：請選擇已建立的圖文訊息'
      const selected = richMessages.value.find((item) => item.id === msg.richMessageId)
      if (!selected) return '圖文訊息：找不到引用內容，請重新選擇'
      if (!selected.altText) {
        return '圖文訊息：引用內容不完整，請到圖文訊息管理補齊'
      }
      if (!selected.transparentBackground && !selected.heroImageUrl) return '圖文訊息：缺少背景圖片'
      if (!Array.isArray(selected.actions) || selected.actions.length < 1) return '圖文訊息：尚未定義任何動作'
      for (const action of selected.actions) {
        const error = validateUnifiedAction({
          slot: action.slot || '',
          type: action.type === 'message' || action.type === 'module' ? action.type : 'uri',
          uri: action.uri || '',
          text: action.text || '',
          moduleId: action.moduleId || '',
          tagging: {
            enabled: action?.tagging?.enabled === true,
            addTagIds: Array.isArray(action?.tagging?.addTagIds) ? action.tagging.addTagIds : [],
          },
        })
        if (error) return `圖文訊息：區塊 ${action.slot} ${error}`
      }
    }

    // carousel buttons are required by design and must be complete
    if (msg?.type === 'carousel' && Array.isArray(msg.columns)) {
      if (msg.columns.length < 1) return '輪播訊息：至少要有 1 個欄位'
      if (msg.columns.length > 10) return '輪播訊息：最多 10 個欄位'
      for (const col of msg.columns) {
        if (!Array.isArray(col?.actions) || col.actions.length < 1) {
          return '輪播訊息：每個欄位至少要有 1 個按鈕'
        }
        if (col.actions.length > 3) return '輪播訊息：每個欄位按鈕最多 3 個'
        for (const action of (col?.actions ?? [])) {
          if (!action?.label?.trim()) return '輪播按鈕文字為必填'
          if (action.type === 'uri' && !action?.uri?.trim()) return '輪播按鈕網址為必填'
          if (action.type === 'message' && !action?.text?.trim()) return '輪播按鈕傳送文字為必填'
          if (action.type === 'module' && !action?.moduleId) return '輪播：請選擇要觸發的機器人模組'
          if (action?.tagging?.enabled === true && (!Array.isArray(action?.tagging?.addTagIds) || action.tagging.addTagIds.length === 0)) {
            return '輪播：已啟用貼標，請至少選擇一個標籤'
          }
        }
      }
    }

    // image carousel action payload must be complete when action is enabled
    if (msg?.type === 'imageCarousel' && Array.isArray(msg.columns)) {
      if (msg.columns.length < 1) return '圖片輪播：至少要有 1 個欄位'
      if (msg.columns.length > 10) return '圖片輪播：最多 10 個欄位'
      for (const col of msg.columns) {
        if (!col?.imageUrl?.trim()) return '圖片輪播：每個欄位都需要圖片'
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
        if (action?.tagging?.enabled === true && (!Array.isArray(action?.tagging?.addTagIds) || action.tagging.addTagIds.length === 0)) {
          return '圖片輪播：已啟用貼標，請至少選擇一個標籤'
        }
      }
    }
  }
  return null
}
</script>
