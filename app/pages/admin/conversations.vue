<template>
  <AdminSplitLayout class="conversations-page" :is-empty="!selectedUserId">
    <!-- ── Sidebar Header ── -->
    <template #sidebar-header>
      <span class="split-sidebar-title">💬 對話</span>
      <el-button size="small" :loading="listLoading" @click="loadList">重整</el-button>
    </template>

    <!-- ── Sidebar List ── -->
    <template #sidebar-list>
      <div class="conv-search-bar">
        <el-input v-model="searchText" placeholder="搜尋名稱…" clearable size="small" />
      </div>
      <div v-if="listLoading" class="split-sidebar-loading">
        <div class="spinner" />
      </div>
      <div v-else-if="!filteredConversations.length" class="split-sidebar-empty">
        <span>{{ searchText ? '無符合結果' : '尚無對話紀錄' }}</span>
      </div>
      <div v-else class="split-list">
        <AdminSplitListItem
          v-for="c in filteredConversations"
          :key="c.userId"
          :title="c.displayName"
          :active="selectedUserId === c.userId"
          :meta-text="(c.lastDirection === 'outgoing' ? '↑ ' : '') + c.lastMessage"
          :meta-truncate="true"
          :chip-text="formatTime(c.lastMessageAt)"
          chip-tone="neutral"
          @select="selectUser(c)"
        />
      </div>
    </template>

    <!-- ── Empty State ── -->
    <template #editor-empty>
      <span class="empty-icon">💬</span>
      <h3>選擇一個對話</h3>
      <p>從左側選擇一位好友，查看訊息紀錄並直接回覆</p>
    </template>

    <!-- ── Editor Header ── -->
    <template #editor-header>
      <div class="conv-user-info">
        <img
          v-if="selectedUser?.pictureUrl"
          :src="selectedUser.pictureUrl"
          class="conv-avatar"
          :alt="selectedUser.displayName"
        />
        <span v-else class="conv-avatar-placeholder">👤</span>
        <div>
          <div class="split-editor-title">{{ selectedUser?.displayName }}</div>
          <div class="conv-user-id text-muted">{{ selectedUserId }}</div>
        </div>
      </div>
    </template>

    <!-- ── Editor Body ── -->
    <template #editor-body>
      <div ref="messagesEl" class="conv-messages">
        <div v-if="msgLoading" class="split-sidebar-loading">
          <div class="spinner" />
        </div>
        <div v-else-if="!messages.length" class="split-empty-state">
          <p>尚無對話內容</p>
        </div>
        <div
          v-for="msg in messages"
          :key="msg.id"
          class="conv-bubble-row"
          :class="msg.direction"
        >
          <div class="conv-bubble-wrap" :class="msg.direction">
            <div
              class="conv-bubble"
              :class="[
                msg.direction,
                { 'is-structured': isStructuredLineMessage(msg), 'is-media': isMediaMessage(msg) },
              ]"
            >
            <template v-if="getMessageType(msg) === 'text'">
              <div v-if="isEmojiOnlyMessage(msg)" class="conv-emoji-message">
                <img
                  v-for="(emoji, idx) in splitEmojiUnits(getMessageDisplayText(msg))"
                  :key="`${msg.id}-emoji-${idx}`"
                  :src="getEmojiImageUrl(emoji)"
                  :alt="emoji"
                  class="conv-emoji-image"
                />
              </div>
              <div v-else class="conv-bubble-text">
                <div v-for="(line, lineIdx) in splitMessageLines(msg)" :key="`${msg.id}-line-${lineIdx}`">
                  <template v-for="(seg, segIdx) in splitMessageLineSegments(line)" :key="`${msg.id}-seg-${lineIdx}-${segIdx}`">
                    <span :class="{ 'conv-link-text': seg.isLink }">{{ seg.text }}</span>
                  </template>
                </div>
              </div>
            </template>
            <template v-else-if="getMessageType(msg) === 'image'">
              <el-image
                v-if="getMessageImageUrl(msg)"
                class="conv-inline-image"
                :src="getMessageImageUrl(msg)"
                fit="contain"
                :preview-src-list="[getMessageImageUrl(msg)]"
                :preview-teleported="true"
              />
            </template>
            <template v-else-if="getMessageType(msg) === 'video'">
              <div class="conv-video-frame">
                <img
                  v-if="getVideoPreviewImageUrl(msg)"
                  :src="getVideoPreviewImageUrl(msg)"
                  alt="video-preview"
                  class="conv-video-preview"
                />
                <div class="conv-video-play">▶</div>
              </div>
            </template>
            <template v-else-if="getMessageType(msg) === 'audio'">
              <a
                v-if="getAudioUrl(msg)"
                :href="getAudioUrl(msg)"
                class="conv-attachment-card"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span class="conv-attachment-card__icon">🎵</span>
                <span class="conv-attachment-card__meta">
                  <span class="conv-attachment-card__title">音訊檔</span>
                  <span class="conv-attachment-card__desc">{{ getAudioDurationLabel(msg) }}</span>
                </span>
              </a>
            </template>
            <template v-else-if="getMessageType(msg) === 'file'">
              <a
                v-if="getFileUrl(msg)"
                :href="getFileUrl(msg)"
                class="conv-attachment-card"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span class="conv-attachment-card__icon">📎</span>
                <span class="conv-attachment-card__meta">
                  <span class="conv-attachment-card__title">{{ getFileName(msg) }}</span>
                  <span class="conv-attachment-card__desc">點擊下載</span>
                </span>
              </a>
            </template>
            <template v-else-if="isStructuredLineMessage(msg)">
              <div class="conv-line-template" :class="`variant-${getStructuredVariant(msg)}`">
                <div class="conv-line-template-cards">
                  <div
                    v-for="(card, cardIdx) in getStructuredCards(msg)"
                    :key="`${msg.id}-card-${cardIdx}`"
                    class="conv-line-card"
                  >
                    <img
                      v-if="card.imageUrl"
                      :src="card.imageUrl"
                      :alt="card.title || 'preview'"
                      class="conv-line-card-image"
                    />
                    <div
                      v-if="getStructuredVariant(msg) === 'image_carousel' && getCardOverlayLabel(card)"
                      class="conv-line-card-image-overlay"
                    >
                      {{ getCardOverlayLabel(card) }}
                    </div>
                    <div v-if="card.title" class="conv-line-card-title">{{ card.title }}</div>
                    <div v-if="card.text" class="conv-line-card-text">{{ card.text }}</div>
                    <div
                      v-if="card.actions.length"
                      class="conv-line-card-actions"
                      :class="{ 'is-line-action': shouldUseLineActionStyle(msg) }"
                    >
                      <button
                        v-for="(act, actIdx) in card.actions"
                        :key="`${msg.id}-act-${cardIdx}-${actIdx}`"
                        type="button"
                        class="conv-line-card-action"
                        :class="{ 'is-line-action': shouldUseLineActionStyle(msg) }"
                      >
                        {{ act }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </template>
            <template v-else-if="getMessageType(msg) === 'sticker'">
              <div class="conv-sticker-message">
                <el-image
                  v-if="getStickerImageUrl(msg)"
                  class="conv-inline-sticker"
                  :src="getStickerImageUrl(msg)"
                  fit="contain"
                  :preview-src-list="[getStickerImageUrl(msg)]"
                  :preview-teleported="true"
                />
              </div>
            </template>
            <template v-else>
              <el-tag size="small" type="info">{{ getMessageType(msg) }}</el-tag>
              <span class="conv-bubble-text">{{ getMessageDisplayText(msg) }}</span>
              <span v-if="getPayloadSummary(msg)" class="conv-bubble-text text-muted">{{ getPayloadSummary(msg) }}</span>
            </template>
            </div>
            <div class="conv-bubble-meta">
              <span v-if="msg.direction === 'outgoing'" class="conv-bubble-read">Read</span>
              <span class="conv-bubble-time">{{ formatTime(msg.timestamp) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="conv-input-tools">
        <div class="conv-picker-actions">
          <el-dropdown trigger="click" placement="top-start" @command="onQuickSendCommand">
            <button
              type="button"
              class="conv-picker-trigger"
              :disabled="sending || msgLoading || !selectedUserId"
              title="傳送媒體"
            >
              <span class="conv-picker-trigger__plus">＋</span>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="action in quickSendActions"
                  :key="action.type"
                  :command="action.type"
                >
                  <span class="conv-quick-send-item">
                    <span class="conv-quick-send-item__icon">{{ action.icon }}</span>
                    <span>{{ action.label }}</span>
                  </span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-popover
            v-for="picker in pickerModes"
            :key="picker.key"
            trigger="click"
            placement="top-start"
            :width="340"
            popper-class="conv-picker-popover"
          >
            <template #reference>
              <button
                type="button"
                class="conv-picker-trigger"
                :disabled="sending"
                :title="picker.title"
              >
                <img
                  :src="picker.triggerIcon"
                  :alt="picker.key"
                  class="conv-picker-trigger__icon"
                />
              </button>
            </template>
            <div class="conv-picker-panel">
              <div class="conv-picker-title">{{ picker.title }}</div>
              <div class="conv-picker-tabs">
                <button
                  v-for="cat in picker.categories"
                  :key="cat.id"
                  type="button"
                  class="conv-picker-tab"
                  :class="{ active: getActiveCategory(picker.key) === cat.id }"
                  @click="setActiveCategory(picker.key, cat.id)"
                >
                  <span>{{ cat.label }}</span>
                </button>
              </div>
              <div class="conv-picker-scrollbox">
                <div class="conv-picker-grid" :class="`conv-picker-grid--${picker.key}`">
                  <button
                    v-for="item in getPickerItems(picker.key)"
                    :key="item.id"
                    type="button"
                    class="conv-picker-option"
                    :class="`conv-picker-option--${picker.key}`"
                    :disabled="sending"
                    @click="onPickerItemSelect(picker.key, item)"
                  >
                    <img
                      v-if="item.kind === 'sticker'"
                      :src="stickerPreviewUrl(item.stickerId)"
                      :alt="`sticker ${item.stickerId}`"
                      class="conv-picker-option__image"
                    />
                    <span v-else class="conv-picker-option__emoji">{{ item.emoji }}</span>
                  </button>
                </div>
              </div>
            </div>
          </el-popover>
          <el-popover
            v-if="selectedUserId && activeSupportPresets.length"
            trigger="click"
            placement="top-start"
            :width="340"
            popper-class="conv-picker-popover"
          >
            <template #reference>
              <button
                type="button"
                class="conv-picker-trigger"
                :disabled="sending || msgLoading"
                title="客服預存"
              >
                <span class="conv-picker-trigger__emoji">📦</span>
              </button>
            </template>
            <div class="conv-picker-panel">
              <div class="conv-picker-title">客服預存</div>
              <div class="conv-picker-scrollbox">
                <div class="conv-support-preset-list">
                  <button
                    v-for="preset in activeSupportPresets"
                    :key="preset.id"
                    type="button"
                    class="conv-support-preset-option"
                    :class="{ active: pendingSupportPresetId === preset.id }"
                    :disabled="isSupportPresetBusy"
                    @click="pendingSupportPresetId = preset.id"
                  >
                    <span class="conv-support-preset-option__name">{{ preset.name || '(未命名)' }}</span>
                    <span class="conv-support-preset-option__meta">{{ getActionSummary(preset) }}</span>
                  </button>
                </div>
              </div>
              <div class="conv-picker-footer">
                <el-button
                  size="small"
                  type="primary"
                  :loading="sending"
                  :disabled="!pendingSupportPresetId || isSupportPresetBusy"
                  @click="sendSupportPreset"
                >
                  確認送出
                </el-button>
              </div>
            </div>
          </el-popover>
        </div>
        <span class="text-muted conv-input-hint">點按按鈕可在附近視窗直接選擇</span>
      </div>

      <div class="conv-input-row">
        <el-input
          v-model="inputText"
          placeholder="輸入訊息（可含 emoji），按 Enter 送出…"
          :disabled="sending"
          @keydown.enter.exact.prevent="send"
        />
        <el-button type="primary" :loading="sending" :disabled="!canSend" @click="send">
          送出
        </el-button>
      </div>
    </template>
  </AdminSplitLayout>

  <el-dialog
    v-model="mediaDialogVisible"
    :title="quickSendDialogTitle"
    width="520px"
    destroy-on-close
  >
    <div class="admin-field-stack conv-quick-send-form">
      <div v-if="quickSendType === 'image'" class="admin-field-group">
        <AdminFieldLabel text="圖片檔案" tight />
        <div class="conv-quick-upload conv-quick-upload--zone">
          <input
            ref="imageInputRef"
            type="file"
            :accept="IMAGE_ACCEPT_ATTR"
            class="admin-hidden-input"
            :disabled="sending || quickMediaUploading"
            @change="onQuickFileChange('image', $event)"
          />
          <div
            v-if="mediaForm.originalContentUrl"
            class="fuz-preview conv-quick-preview-zone"
          >
            <img :src="mediaForm.originalContentUrl" alt="image-preview" class="fuz-preview-img" />
            <div class="fuz-preview-overlay">
              <el-button size="small" type="primary" :disabled="sending || quickMediaUploading" @click="triggerQuickPick('image')">
                更換圖片
              </el-button>
            </div>
          </div>
          <div
            v-else
            class="upload-zone fuz-zone"
            :class="{ uploading: quickMediaUploading }"
            @click="triggerQuickPick('image')"
          >
            <div class="fuz-idle">
              <span class="fuz-icon">📷</span>
              <span class="fuz-label">點擊上傳圖片</span>
              <el-button type="primary" size="small" class="admin-btn-compact fuz-upload-btn" :disabled="sending || quickMediaUploading">
                選擇圖片
              </el-button>
              <span class="fuz-hint">JPG / PNG，最大 {{ imageMaxKb }}KB</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="quickSendType === 'video'" class="admin-field-group">
        <AdminFieldLabel text="影片檔案" tight />
        <div class="conv-quick-upload conv-quick-upload--zone">
          <input
            ref="videoInputRef"
            type="file"
            :accept="VIDEO_ACCEPT_ATTR"
            class="admin-hidden-input"
            :disabled="sending || quickMediaUploading"
            @change="onQuickFileChange('video', $event)"
          />
          <div
            v-if="mediaForm.originalContentUrl"
            class="fuz-preview conv-quick-preview-zone"
          >
            <video :src="mediaForm.originalContentUrl" class="fuz-preview-img" controls preload="metadata" />
            <div class="fuz-preview-overlay">
              <el-button size="small" type="primary" :disabled="sending || quickMediaUploading" @click="triggerQuickPick('video')">
                更換影片
              </el-button>
            </div>
          </div>
          <div
            v-else
            class="upload-zone fuz-zone"
            :class="{ uploading: quickMediaUploading }"
            @click="triggerQuickPick('video')"
          >
            <div class="fuz-idle">
              <span class="fuz-icon">🎬</span>
              <span class="fuz-label">點擊上傳影片</span>
              <el-button type="primary" size="small" class="admin-btn-compact fuz-upload-btn" :disabled="sending || quickMediaUploading">
                選擇影片
              </el-button>
              <span class="fuz-hint">MP4，最大 {{ videoMaxMb }}MB（系統會自動產生預覽）</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="quickSendType === 'audio'" class="admin-field-group">
        <AdminFieldLabel text="音訊檔案" tight />
        <div class="conv-quick-upload">
          <input
            ref="audioInputRef"
            type="file"
            :accept="AUDIO_ACCEPT_ATTR"
            class="admin-hidden-input"
            :disabled="sending || quickMediaUploading"
            @change="onQuickFileChange('audio', $event)"
          />
          <el-button :disabled="sending || quickMediaUploading" @click="triggerQuickPick('audio')">
            {{ mediaForm.originalContentUrl ? '重新上傳音訊' : '選擇音訊' }}
          </el-button>
          <span class="conv-quick-upload__hint">M4A / MP3 / WAV，最大 {{ audioMaxMb }}MB</span>
        </div>
      </div>

      <div v-if="quickMediaUploading" class="conv-quick-uploading text-muted">
        上傳中，請稍候...
      </div>
    </div>
    <template #footer>
      <div class="conv-quick-send-form__footer">
        <el-button :disabled="sending || quickMediaUploading" @click="mediaDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="sending" :disabled="!canSendQuickMedia" @click="sendQuickMedia">
          送出
        </el-button>
      </div>
    </template>
  </el-dialog>

  <AdminToastStack :toasts="toasts" />
</template>

<script setup lang="ts">
import {
  AUDIO_ACCEPT_ATTR,
  AUDIO_MAX_BYTES,
  IMAGE_ACCEPT_ATTR,
  IMAGE_MAX_BYTES,
  VIDEO_ACCEPT_ATTR,
  VIDEO_MAX_BYTES,
} from '~~/shared/upload-rules'

definePageMeta({ middleware: 'auth', layout: 'default' })

interface ConvItem {
  userId: string
  displayName: string
  pictureUrl: string
  lastMessage: string
  lastDirection: 'incoming' | 'outgoing'
  lastMessageAt: any
}

interface MsgItem {
  id: string
  direction: 'incoming' | 'outgoing'
  text: string
  messageType?: string
  payload?: any
  timestamp: any
}

type PickerKind = 'emoji' | 'sticker'
type QuickSendType = 'image' | 'video' | 'audio'

type PickerCategory = {
  id: string
  label: string
}

type PickerItem =
  | { id: string, kind: 'emoji', emoji: string }
  | { id: string, kind: 'sticker', packageId: string, stickerId: string }

type MessageTextSegment = {
  text: string
  isLink: boolean
}

type StructuredCardPreview = {
  title: string
  text: string
  imageUrl: string
  actions: string[]
}

type StructuredVariant = 'buttons' | 'confirm' | 'carousel' | 'image_carousel' | 'flex' | 'imagemap' | 'generic'

type StructuredMessagePreview = {
  variant: StructuredVariant
  cards: StructuredCardPreview[]
}

const { toasts, showToast } = useAdminToast()
const { uploadToStorage, validateFile } = useMediaUpload()
const listLoading = ref(false)
const msgLoading = ref(false)
const sending = ref(false)
const conversations = ref<ConvItem[]>([])
const messages = ref<MsgItem[]>([])
const selectedUserId = ref<string | null>(null)
const selectedUser = ref<ConvItem | null>(null)
const inputText = ref('')
const searchText = ref('')
const messagesEl = ref<HTMLElement | null>(null)
const supportPresetsRaw = ref<any[]>([])
const pendingSupportPresetId = ref('')
const mediaDialogVisible = ref(false)
const quickMediaUploading = ref(false)
const quickSendType = ref<QuickSendType>('image')
const imageInputRef = ref<HTMLInputElement | null>(null)
const videoInputRef = ref<HTMLInputElement | null>(null)
const audioInputRef = ref<HTMLInputElement | null>(null)
const mediaForm = ref({
  originalContentUrl: '',
  previewImageUrl: '',
  durationSeconds: 5,
})
const imageMaxKb = Math.floor(IMAGE_MAX_BYTES / 1024)
const videoMaxMb = Math.floor(VIDEO_MAX_BYTES / (1024 * 1024))
const audioMaxMb = Math.floor(AUDIO_MAX_BYTES / (1024 * 1024))

const activeSupportPresets = computed(() =>
  supportPresetsRaw.value.filter((p: any) => p.isActive !== false),
)
const isSupportPresetBusy = computed(() => sending.value || msgLoading.value)
const quickSendActions: Array<{ type: QuickSendType, label: string, icon: string }> = [
  { type: 'image', label: '圖片', icon: '🖼️' },
  { type: 'video', label: '影片', icon: '🎬' },
  { type: 'audio', label: '音訊', icon: '🎵' },
]
const quickSendDialogTitle = computed(() => {
  const label = quickSendActions.find(action => action.type === quickSendType.value)?.label || ''
  return `傳送${label}`
})
const canSendQuickMedia = computed(() => {
  if (quickMediaUploading.value) return false
  const originalContentUrl = String(mediaForm.value.originalContentUrl || '').trim()
  if (!originalContentUrl) return false
  if (quickSendType.value === 'audio') {
    return Number(mediaForm.value.durationSeconds) > 0
  }
  return true
})

const EMOJI_ALL = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍',
  '🤩', '😘', '😗', '☺️', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🫠', '🤗', '🤭',
  '🫢', '🫣', '🤫', '🤔', '🫡', '🤐', '🤨', '😐', '😑', '😶', '🫥', '😶‍🌫️', '😏', '😒', '🙄',
  '😬', '😮‍💨', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵',
  '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐', '😕', '🫤', '😟', '🙁', '☹️',
  '😮', '😯', '😲', '😳', '🥺', '🥹', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖',
  '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩',
  '🤡', '👹', '👺', '👻', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀',
  '😿', '😾', '🫶', '👐', '🙌', '👏', '🤝', '👍', '👎', '👊', '✊', '🤛', '🤜', '🫷', '🫸',
  '🤞', '✌️', '🤟', '🤘', '👌', '🤏', '🫰', '🤌', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️',
  '🫵', '🙏', '🫱', '🫲', '💪', '🦾', '🧠', '🫀', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤',
  '🩶', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💯', '💢', '💥',
  '💫', '💦', '💨', '🕳️', '💬', '👋', '🙈', '🙉', '🙊', '🔥', '✨', '⭐', '🌟', '🎉', '🎊',
]

const activeEmojiCategory = ref('recent')
const recentEmojis = ref<string[]>(['😀', '😂', '🥹', '🙏', '🎉', '❤️', '👍', '🔥'])
const emojiCategories: PickerCategory[] = [
  { id: 'recent', label: '🕘' },
  { id: 'smileys', label: '🙂' },
  { id: 'gestures', label: '👋' },
  { id: 'hearts', label: '❤️' },
  { id: 'symbols', label: '✨' },
]

const emojiCategoryMap: Record<string, string[]> = {
  smileys: EMOJI_ALL.slice(0, 130),
  gestures: EMOJI_ALL.slice(130, 170),
  hearts: EMOJI_ALL.slice(170, 186),
  symbols: EMOJI_ALL.slice(186),
}

function buildStickerRange(packageId: string, start: number, end: number) {
  const list: Array<{ packageId: string, stickerId: string }> = []
  for (let id = start; id <= end; id++) {
    list.push({ packageId, stickerId: String(id) })
  }
  return list
}

const activeStickerCategory = ref('cute')
const stickerCategories: PickerCategory[] = [
  { id: 'cute', label: '⭐' },
  { id: 'funny', label: '🤣' },
  { id: 'reaction', label: '💬' },
]

const stickerCategoryMap: Record<string, Array<{ packageId: string, stickerId: string }>> = {
  cute: [
    ...buildStickerRange('11537', 52002734, 52002767),
  ],
  funny: [
    ...buildStickerRange('11538', 51626494, 51626533),
  ],
  reaction: [
    ...buildStickerRange('11539', 52114110, 52114149),
  ],
}

const pickerModes: Array<{
  key: PickerKind
  title: string
  triggerIcon: string
  categories: PickerCategory[]
}> = [
  {
    key: 'emoji',
    title: 'Emoji',
    triggerIcon: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f600.png',
    categories: emojiCategories,
  },
  {
    key: 'sticker',
    title: 'LINE 貼圖',
    triggerIcon: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f9e9.png',
    categories: stickerCategories,
  },
]

const filteredConversations = computed(() => {
  if (!searchText.value.trim()) return conversations.value
  const kw = searchText.value.toLowerCase()
  return conversations.value.filter(c => c.displayName.toLowerCase().includes(kw))
})

const canSend = computed(() => !!inputText.value.trim())

async function loadList() {
  listLoading.value = true
  try {
    const res = await $fetch<{ conversations: ConvItem[] }>('/api/conversations/list')
    conversations.value = res.conversations
  }
  catch {
    showToast('載入對話列表失敗', 'error')
  }
  finally {
    listLoading.value = false
  }
}

async function loadSupportPresets() {
  supportPresetsRaw.value = await $fetch<any[]>('/api/support-preset/list').catch(() => [])
}

async function sendSupportPreset() {
  const presetId = pendingSupportPresetId.value
  if (!presetId || !selectedUserId.value || !selectedUser.value) return
  sending.value = true
  try {
    await $fetch(`/api/conversations/${selectedUserId.value}/send-preset`, {
      method: 'POST',
      body: { presetId },
    })
    showToast('已送出客服預存', 'success')
    await selectUser(selectedUser.value)
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage || '送出預存失敗', 'error')
  }
  finally {
    sending.value = false
    pendingSupportPresetId.value = ''
  }
}

function getActionSummary(preset: any): string {
  const action = preset?.action || {}
  if (action.type === 'module') return '觸發機器人模組'
  if (action.type === 'uri') return action.uri || '開啟網址'
  return action.text || '傳送文字'
}

async function selectUser(c: ConvItem) {
  selectedUserId.value = c.userId
  selectedUser.value = c
  pendingSupportPresetId.value = ''
  messages.value = []
  msgLoading.value = true
  try {
    const res = await $fetch<{ messages: MsgItem[] }>(`/api/conversations/${c.userId}/messages`)
    messages.value = res.messages
    await nextTick()
    scrollToBottom()
  }
  catch {
    showToast('載入訊息失敗', 'error')
  }
  finally {
    msgLoading.value = false
  }
}

async function send() {
  if (!selectedUserId.value) return
  sending.value = true
  try {
    const text = inputText.value.trim()
    if (!text) return
    await $fetch(`/api/conversations/${selectedUserId.value}/send`, {
      method: 'POST',
      body: { type: 'text', text },
    })
    inputText.value = ''
    await selectUser(selectedUser.value!)
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage || '發送失敗', 'error')
  }
  finally {
    sending.value = false
  }
}

function resetQuickMediaForm() {
  quickMediaUploading.value = false
  mediaForm.value = {
    originalContentUrl: '',
    previewImageUrl: '',
    durationSeconds: 5,
  }
  clearQuickFileInputs()
}

function clearQuickFileInputs() {
  if (imageInputRef.value) imageInputRef.value.value = ''
  if (videoInputRef.value) videoInputRef.value.value = ''
  if (audioInputRef.value) audioInputRef.value.value = ''
}

type QuickPickKind = 'image' | 'video' | 'audio'

function triggerQuickPick(kind: QuickPickKind) {
  if (kind === 'image') imageInputRef.value?.click()
  else if (kind === 'video') videoInputRef.value?.click()
  else if (kind === 'audio') audioInputRef.value?.click()
}

function toUploadMediaKind(kind: QuickPickKind): 'image' | 'video' | 'audio' {
  if (kind === 'image') return 'image'
  if (kind === 'video') return 'video'
  return 'audio'
}

async function getAudioDurationSeconds(file: File): Promise<number> {
  return await new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file)
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      const duration = Number(audio.duration)
      URL.revokeObjectURL(objectUrl)
      resolve(Number.isFinite(duration) && duration > 0 ? Math.max(1, Math.round(duration)) : 5)
    }
    audio.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(5)
    }
    audio.src = objectUrl
  })
}

async function createVideoPreviewFile(file: File): Promise<File | null> {
  if (typeof document === 'undefined') return null
  const objectUrl = URL.createObjectURL(file)
  try {
    const frameBlob = await new Promise<Blob | null>((resolve) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.muted = true
      video.playsInline = true

      video.onloadeddata = () => {
        const sourceWidth = video.videoWidth || 1280
        const sourceHeight = video.videoHeight || 720
        const targetWidth = Math.min(sourceWidth, 960)
        const targetHeight = Math.max(1, Math.round((sourceHeight / sourceWidth) * targetWidth))
        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(video, 0, 0, targetWidth, targetHeight)
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.86)
      }

      video.onerror = () => resolve(null)
      video.src = objectUrl
    })

    if (!frameBlob) return null
    const baseName = file.name.replace(/\.[^/.]+$/, '') || 'video'
    return new File([frameBlob], `${baseName}-preview.jpg`, { type: 'image/jpeg' })
  }
  finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function onQuickFileChange(kind: QuickPickKind, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  const validation = validateFile(file, toUploadMediaKind(kind))
  if (!validation.ok) {
    showToast(validation.message, 'error')
    return
  }

  quickMediaUploading.value = true
  try {
    const url = await uploadToStorage(file)
    if (!url) throw new Error('empty upload url')

    if (kind === 'image') {
      mediaForm.value.originalContentUrl = url
      mediaForm.value.previewImageUrl = url
    }
    else if (kind === 'video') {
      mediaForm.value.originalContentUrl = url
      mediaForm.value.previewImageUrl = url
      const previewFile = await createVideoPreviewFile(file)
      if (previewFile) {
        try {
          const previewUrl = await uploadToStorage(previewFile)
          mediaForm.value.previewImageUrl = previewUrl || url
        }
        catch {
          showToast('已上傳影片，預覽圖自動產生失敗，將使用影片連結', 'error')
        }
      }
    }
    else if (kind === 'audio') {
      mediaForm.value.originalContentUrl = url
      mediaForm.value.durationSeconds = await getAudioDurationSeconds(file)
    }
  }
  catch {
    showToast('上傳失敗，請稍後再試', 'error')
  }
  finally {
    quickMediaUploading.value = false
  }
}

function onQuickSendCommand(command: string | number | object) {
  const type = String(command || '') as QuickSendType
  if (!selectedUserId.value) {
    showToast('請先選擇一位使用者', 'error')
    return
  }
  if (!quickSendActions.some(action => action.type === type)) return
  quickSendType.value = type
  resetQuickMediaForm()
  mediaDialogVisible.value = true
}

async function sendQuickMedia() {
  if (!selectedUserId.value || !canSendQuickMedia.value) return
  const body: Record<string, any> = {
    type: quickSendType.value,
    originalContentUrl: String(mediaForm.value.originalContentUrl || '').trim(),
  }
  if (quickSendType.value === 'image' || quickSendType.value === 'video') {
    body.previewImageUrl = String(mediaForm.value.previewImageUrl || mediaForm.value.originalContentUrl || '').trim()
  }
  if (quickSendType.value === 'audio') {
    body.duration = Math.round(Number(mediaForm.value.durationSeconds) * 1000)
  }

  sending.value = true
  try {
    await $fetch(`/api/conversations/${selectedUserId.value}/send`, {
      method: 'POST',
      body,
    })
    mediaDialogVisible.value = false
    resetQuickMediaForm()
    await selectUser(selectedUser.value!)
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage || '發送失敗', 'error')
  }
  finally {
    sending.value = false
  }
}

function scrollToBottom() {
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  }
}

function formatTime(ts: any): string {
  if (!ts) return ''
  const d = ts?.toDate ? ts.toDate() : new Date(ts._seconds ? ts._seconds * 1000 : ts)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })
}

function getActiveCategory(kind: PickerKind): string {
  return kind === 'emoji' ? activeEmojiCategory.value : activeStickerCategory.value
}

function setActiveCategory(kind: PickerKind, categoryId: string) {
  if (kind === 'emoji') activeEmojiCategory.value = categoryId
  else activeStickerCategory.value = categoryId
}

function getPickerItems(kind: PickerKind): PickerItem[] {
  if (kind === 'emoji') {
    const active = activeEmojiCategory.value
    const list = active === 'recent'
      ? recentEmojis.value
      : (emojiCategoryMap[active] || EMOJI_ALL)
    return list.map(emoji => ({ id: `emoji-${emoji}`, kind: 'emoji', emoji }))
  }

  const stickers = stickerCategoryMap[activeStickerCategory.value] ?? stickerCategoryMap.cute ?? []
  return stickers.map(preset => ({
    id: `sticker-${preset.packageId}-${preset.stickerId}`,
    kind: 'sticker',
    packageId: preset.packageId,
    stickerId: preset.stickerId,
  }))
}

function onPickerItemSelect(kind: PickerKind, item: PickerItem) {
  if (kind === 'emoji' && item.kind === 'emoji') {
    appendEmoji(item.emoji)
    return
  }
  if (kind === 'sticker' && item.kind === 'sticker') {
    sendSticker(item.packageId, item.stickerId)
  }
}

function appendEmoji(emoji: string) {
  inputText.value += emoji
  recentEmojis.value = [
    emoji,
    ...recentEmojis.value.filter(item => item !== emoji),
  ].slice(0, 16)
}

async function sendSticker(packageId: string, sid: string) {
  if (!selectedUserId.value) {
    showToast('請先選擇一位使用者', 'error')
    return
  }
  sending.value = true
  try {
    await $fetch(`/api/conversations/${selectedUserId.value}/send`, {
      method: 'POST',
      body: { type: 'sticker', packageId, stickerId: sid },
    })
    await selectUser(selectedUser.value!)
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage || '發送失敗', 'error')
  }
  finally {
    sending.value = false
  }
}

function stickerPreviewUrl(stickerSid: string): string {
  return `https://stickershop.line-scdn.net/stickershop/v1/sticker/${stickerSid}/android/sticker.png`
}

function getMessageType(msg: MsgItem): string {
  const payloadType = String(msg?.payload?.type || '').trim()
  if (payloadType) return payloadType
  return String(msg?.messageType || 'text')
}

function getMessageDisplayText(msg: MsgItem): string {
  const type = getMessageType(msg)
  if (type === 'text') {
    const payloadText = String(msg?.payload?.text || '').trim()
    return payloadText || msg.text || ''
  }
  if (type === 'template' || type === 'flex') {
    const altText = String(msg?.payload?.altText || '').trim()
    return altText || msg.text || ''
  }
  return msg.text || ''
}

function splitMessageLines(msg: MsgItem): string[] {
  return getMessageDisplayText(msg).split('\n')
}

function splitMessageLineSegments(line: string): MessageTextSegment[] {
  const text = String(line || '')
  if (!text) return [{ text: '', isLink: false }]
  const urlRegex = /(https?:\/\/[^\s]+)/g
  const segments: MessageTextSegment[] = []
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = urlRegex.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, m.index), isLink: false })
    }
    segments.push({ text: m[0], isLink: true })
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isLink: false })
  }
  return segments.length ? segments : [{ text, isLink: false }]
}

function getQuickReplyItems(msg: MsgItem): string[] {
  const items = msg?.payload?.quickReply?.items
  if (!Array.isArray(items)) return []
  return items
    .map((item: any) => String(item?.action?.label || item?.action?.text || '').trim())
    .filter(Boolean)
    .slice(0, 8)
}

function isStructuredLineMessage(msg: MsgItem): boolean {
  const type = getMessageType(msg)
  return type === 'template' || type === 'flex' || type === 'imagemap'
}

function isMediaMessage(msg: MsgItem): boolean {
  const type = getMessageType(msg)
  return type === 'image' || type === 'sticker' || type === 'video'
}

function toActionLabel(action: any): string {
  return String(
    action?.label
      || action?.text
      || action?.displayText
      || action?.uri
      || action?.data
      || action?.type
      || '動作',
  ).trim().slice(0, 42)
}

function normalizeCard(input?: Partial<StructuredCardPreview>): StructuredCardPreview {
  const actions = Array.isArray(input?.actions) ? input.actions.filter(Boolean) : []
  return {
    title: String(input?.title || '').trim(),
    text: String(input?.text || '').trim(),
    imageUrl: String(input?.imageUrl || '').trim(),
    actions,
  }
}

function extractFlexTexts(node: any, acc: string[] = []): string[] {
  if (!node || typeof node !== 'object') return acc
  if (typeof node.text === 'string' && node.text.trim()) acc.push(node.text.trim())
  if (Array.isArray(node.contents)) {
    node.contents.forEach((child: any) => extractFlexTexts(child, acc))
  }
  if (node.header) extractFlexTexts(node.header, acc)
  if (node.body) extractFlexTexts(node.body, acc)
  if (node.footer) extractFlexTexts(node.footer, acc)
  return acc
}

function extractFlexActions(node: any, acc: string[] = []): string[] {
  if (!node || typeof node !== 'object') return acc
  if (node.action) acc.push(toActionLabel(node.action))
  if (Array.isArray(node.contents)) {
    node.contents.forEach((child: any) => extractFlexActions(child, acc))
  }
  if (node.header) extractFlexActions(node.header, acc)
  if (node.body) extractFlexActions(node.body, acc)
  if (node.footer) extractFlexActions(node.footer, acc)
  return acc
}

function getStructuredMessagePreview(msg: MsgItem): StructuredMessagePreview | null {
  const payload = msg?.payload || {}
  const type = getMessageType(msg)

  if (type === 'template') {
    const tpl = payload?.template || {}
    const tplType = String(tpl?.type || '').trim()
    if (tplType === 'buttons') {
      const title = String(tpl.title || '').trim()
      const text = String(tpl.text || '').trim()
      return {
        variant: 'buttons',
        cards: [normalizeCard({
          title: title || text,
          text: title ? text : '',
          imageUrl: tpl.thumbnailImageUrl,
          actions: Array.isArray(tpl.actions) ? tpl.actions.map(toActionLabel) : [],
        })],
      }
    }
    if (tplType === 'confirm') {
      const text = String(tpl.text || '').trim()
      return {
        variant: 'confirm',
        cards: [normalizeCard({
          title: text,
          text: '',
          actions: Array.isArray(tpl.actions) ? tpl.actions.map(toActionLabel) : [],
        })],
      }
    }
    if (tplType === 'carousel') {
      return {
        variant: 'carousel',
        cards: (Array.isArray(tpl.columns) ? tpl.columns : []).map((c: any) => normalizeCard({
          title: c.title,
          text: c.text,
          imageUrl: c.thumbnailImageUrl,
          actions: Array.isArray(c.actions) ? c.actions.map(toActionLabel) : [],
        })),
      }
    }
    if (tplType === 'image_carousel') {
      return {
        variant: 'image_carousel',
        cards: (Array.isArray(tpl.columns) ? tpl.columns : []).map((c: any) => normalizeCard({
          imageUrl: c.imageUrl,
          actions: c.action ? [toActionLabel(c.action)] : [],
        })),
      }
    }
    return { variant: 'generic', cards: [normalizeCard({ text: payload.altText || msg.text })] }
  }

  if (type === 'flex') {
    const contents = payload?.contents
    if (contents?.type === 'carousel' && Array.isArray(contents.contents)) {
      return {
        variant: 'carousel',
        cards: contents.contents.map((bubble: any) => {
          const texts = extractFlexTexts(bubble, []).slice(0, 3)
          const actions = extractFlexActions(bubble, []).slice(0, 4)
          return normalizeCard({
            title: texts[0],
            text: texts.slice(1).join('\n'),
            actions,
          })
        }),
      }
    }
    const texts = extractFlexTexts(contents, []).slice(0, 4)
    const actions = extractFlexActions(contents, []).slice(0, 4)
    return {
      variant: 'flex',
      cards: [normalizeCard({
        title: texts[0],
        text: texts.slice(1).join('\n') || payload?.altText || msg.text,
        actions,
      })],
    }
  }

  if (type === 'imagemap') {
    return {
      variant: 'imagemap',
      cards: [normalizeCard({
        text: payload?.altText || msg.text || 'Imagemap',
        imageUrl: payload?.baseUrl ? `${payload.baseUrl}/1040` : '',
        actions: Array.isArray(payload?.actions) ? payload.actions.map(toActionLabel) : [],
      })],
    }
  }

  return { variant: 'generic', cards: [normalizeCard({ text: msg.text })] }
}

function getStructuredVariant(msg: MsgItem): StructuredVariant {
  return getStructuredMessagePreview(msg)?.variant || 'generic'
}

function getStructuredCards(msg: MsgItem): StructuredCardPreview[] {
  return getStructuredMessagePreview(msg)?.cards || []
}

function getCardOverlayLabel(card: StructuredCardPreview): string {
  const fromAction = Array.isArray(card.actions) && card.actions.length > 0
    ? String(card.actions[0] || '').trim()
    : ''
  if (fromAction && fromAction.toLowerCase() !== 'ignore') return fromAction
  return String(card.title || '').trim()
}

function shouldUseLineActionStyle(msg: MsgItem): boolean {
  const variant = getStructuredVariant(msg)
  return variant === 'buttons' || variant === 'confirm' || variant === 'carousel'
}

function getMessageImageUrl(msg: MsgItem): string {
  if (getMessageType(msg) !== 'image') return ''
  return String(msg?.payload?.previewImageUrl || msg?.payload?.originalContentUrl || '').trim()
}

function getVideoPreviewImageUrl(msg: MsgItem): string {
  if (getMessageType(msg) !== 'video') return ''
  return String(msg?.payload?.previewImageUrl || msg?.payload?.originalContentUrl || '').trim()
}

function getStickerImageUrl(msg: MsgItem): string {
  if (getMessageType(msg) !== 'sticker') return ''
  const sid = String(msg?.payload?.stickerId || '').trim()
  if (!sid) return ''
  return stickerPreviewUrl(sid)
}

function getAudioUrl(msg: MsgItem): string {
  if (getMessageType(msg) !== 'audio') return ''
  return String(msg?.payload?.originalContentUrl || '').trim()
}

function getAudioDurationLabel(msg: MsgItem): string {
  if (getMessageType(msg) !== 'audio') return ''
  const durationMs = Number(msg?.payload?.duration || 0)
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '音訊'
  return `${Math.max(1, Math.round(durationMs / 1000))} 秒`
}

function getFileUrl(msg: MsgItem): string {
  if (getMessageType(msg) !== 'file') return ''
  return String(msg?.payload?.originalContentUrl || '').trim()
}

function getFileName(msg: MsgItem): string {
  if (getMessageType(msg) !== 'file') return ''
  const fileName = String(msg?.payload?.fileName || '').trim()
  return fileName || '檔案'
}

function splitEmojiUnits(text: string): string[] {
  const source = String(text || '').trim()
  if (!source) return []
  const segmenter = typeof Intl !== 'undefined' && (Intl as any).Segmenter
    ? new (Intl as any).Segmenter('en', { granularity: 'grapheme' })
    : null
  const units = segmenter
    ? Array.from(segmenter.segment(source), (s: any) => s.segment as string)
    : Array.from(source)
  return units.filter(u => /\p{Extended_Pictographic}/u.test(u))
}

function isEmojiOnlyMessage(msg: MsgItem): boolean {
  const text = getMessageDisplayText(msg).trim()
  if (!text) return false
  const withoutSpaces = text.replace(/\s+/g, '')
  if (!withoutSpaces) return false
  const emojis = splitEmojiUnits(withoutSpaces)
  if (!emojis.length || emojis.length > 8) return false
  return emojis.join('') === withoutSpaces
}

function getEmojiImageUrl(emoji: string): string {
  const codePoints = Array.from(emoji)
    .map(ch => ch.codePointAt(0)?.toString(16))
    .filter((cp): cp is string => Boolean(cp) && cp !== 'fe0f')
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${codePoints.join('-')}.png`
}

function getPayloadSummary(msg: MsgItem): string {
  const payload = msg?.payload
  if (!payload || typeof payload !== 'object') return ''
  if (payload.type === 'template' && payload.template?.type) {
    return `template: ${String(payload.template.type)}`
  }
  if (payload.type === 'flex' && payload.contents?.type) {
    return `flex: ${String(payload.contents.type)}`
  }
  if (payload.type === 'imagemap') {
    const actions = Array.isArray(payload.actions) ? payload.actions.length : 0
    return actions > 0 ? `imagemap actions: ${actions}` : 'imagemap'
  }
  if (payload.type === 'sticker') {
    return ''
  }
  return ''
}

onMounted(() => {
  loadList()
  loadSupportPresets()
})
</script>
