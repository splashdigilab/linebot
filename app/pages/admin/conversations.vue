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
              <div v-if="getQuickReplyItems(msg).length" class="conv-quick-reply-row">
                <span
                  v-for="(qr, qrIdx) in getQuickReplyItems(msg)"
                  :key="`${msg.id}-qr-${qrIdx}`"
                  class="conv-quick-reply-chip"
                >
                  {{ qr }}
                </span>
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
            <template v-else-if="isStructuredLineMessage(msg)">
              <div class="conv-line-template">
                <div class="conv-line-template-head">{{ getStructuredMessageTitle(msg) }}</div>
                <div class="conv-line-template-cards">
                  <div
                    v-for="(card, cardIdx) in getStructuredMessageCards(msg)"
                    :key="`${msg.id}-card-${cardIdx}`"
                    class="conv-line-card"
                  >
                    <img
                      v-if="card.imageUrl"
                      :src="card.imageUrl"
                      :alt="card.title || 'preview'"
                      class="conv-line-card-image"
                    />
                    <div v-if="card.title" class="conv-line-card-title">{{ card.title }}</div>
                    <div v-if="card.text" class="conv-line-card-text">{{ card.text }}</div>
                    <div class="conv-line-card-actions">
                      <button
                        v-for="(act, actIdx) in card.actions"
                        :key="`${msg.id}-act-${cardIdx}-${actIdx}`"
                        type="button"
                        class="conv-line-card-action"
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

  <AdminToastStack :toasts="toasts" />
</template>

<script setup lang="ts">
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

const { toasts, showToast } = useAdminToast()
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
  { id: 'classic', label: '🐻' },
]

const stickerCategoryMap: Record<string, Array<{ packageId: string, stickerId: string }>> = {
  cute: [
    ...buildStickerRange('11537', 52002734, 52002767),
    ...buildStickerRange('11538', 51626494, 51626533),
  ],
  funny: [
    ...buildStickerRange('11539', 52114110, 52114149),
    ...buildStickerRange('11540', 52114150, 52114189),
  ],
  reaction: [
    ...buildStickerRange('11541', 52114190, 52114229),
    ...buildStickerRange('11542', 52114230, 52114269),
  ],
  classic: [
    ...buildStickerRange('11544', 52114294, 52114333),
    ...buildStickerRange('11545', 52114334, 52114373),
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

async function selectUser(c: ConvItem) {
  selectedUserId.value = c.userId
  selectedUser.value = c
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
  return type === 'image' || type === 'sticker'
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

function getStructuredMessageTitle(msg: MsgItem): string {
  const type = getMessageType(msg)
  if (type === 'template') return 'LINE 模板訊息'
  if (type === 'flex') return 'LINE Flex 訊息'
  return 'LINE 圖像互動訊息'
}

function getStructuredMessageCards(msg: MsgItem): StructuredCardPreview[] {
  const payload = msg?.payload || {}
  const type = getMessageType(msg)

  if (type === 'template') {
    const tpl = payload?.template || {}
    const tplType = String(tpl?.type || '').trim()
    if (tplType === 'buttons') {
      return [normalizeCard({
        title: tpl.title,
        text: tpl.text,
        imageUrl: tpl.thumbnailImageUrl,
        actions: Array.isArray(tpl.actions) ? tpl.actions.map(toActionLabel) : [],
      })]
    }
    if (tplType === 'confirm') {
      return [normalizeCard({
        text: tpl.text,
        actions: Array.isArray(tpl.actions) ? tpl.actions.map(toActionLabel) : [],
      })]
    }
    if (tplType === 'carousel') {
      return (Array.isArray(tpl.columns) ? tpl.columns : []).map((c: any) => normalizeCard({
        title: c.title,
        text: c.text,
        imageUrl: c.thumbnailImageUrl,
        actions: Array.isArray(c.actions) ? c.actions.map(toActionLabel) : [],
      }))
    }
    if (tplType === 'image_carousel') {
      return (Array.isArray(tpl.columns) ? tpl.columns : []).map((c: any) => normalizeCard({
        imageUrl: c.imageUrl,
        actions: c.action ? [toActionLabel(c.action)] : [],
      }))
    }
    return [normalizeCard({ text: payload.altText || msg.text })]
  }

  if (type === 'flex') {
    const contents = payload?.contents
    if (contents?.type === 'carousel' && Array.isArray(contents.contents)) {
      return contents.contents.map((bubble: any) => {
        const texts = extractFlexTexts(bubble, []).slice(0, 3)
        const actions = extractFlexActions(bubble, []).slice(0, 4)
        return normalizeCard({
          title: texts[0],
          text: texts.slice(1).join('\n'),
          actions,
        })
      })
    }
    const texts = extractFlexTexts(contents, []).slice(0, 4)
    const actions = extractFlexActions(contents, []).slice(0, 4)
    return [normalizeCard({
      title: texts[0],
      text: texts.slice(1).join('\n') || payload?.altText || msg.text,
      actions,
    })]
  }

  if (type === 'imagemap') {
    return [normalizeCard({
      text: payload?.altText || msg.text || 'Imagemap',
      imageUrl: payload?.baseUrl ? `${payload.baseUrl}/1040` : '',
      actions: Array.isArray(payload?.actions) ? payload.actions.map(toActionLabel) : [],
    })]
  }

  return [normalizeCard({ text: msg.text })]
}

function getMessageImageUrl(msg: MsgItem): string {
  if (getMessageType(msg) !== 'image') return ''
  return String(msg?.payload?.previewImageUrl || msg?.payload?.originalContentUrl || '').trim()
}

function getStickerImageUrl(msg: MsgItem): string {
  if (getMessageType(msg) !== 'sticker') return ''
  const sid = String(msg?.payload?.stickerId || '').trim()
  if (!sid) return ''
  return stickerPreviewUrl(sid)
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

onMounted(loadList)
</script>
