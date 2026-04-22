<template>
  <AdminSplitLayout :is-empty="!selectedUserId">
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
          <div class="conv-bubble" :class="msg.direction">
            <span class="conv-bubble-text">{{ msg.text }}</span>
            <span class="conv-bubble-time text-muted">{{ formatTime(msg.timestamp) }}</span>
          </div>
        </div>
      </div>

      <div class="conv-input-row">
        <el-input
          v-model="inputText"
          placeholder="輸入訊息，按 Enter 送出…"
          :disabled="sending"
          @keydown.enter.exact.prevent="send"
        />
        <el-button type="primary" :loading="sending" :disabled="!inputText.trim()" @click="send">
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
  timestamp: any
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

const filteredConversations = computed(() => {
  if (!searchText.value.trim()) return conversations.value
  const kw = searchText.value.toLowerCase()
  return conversations.value.filter(c => c.displayName.toLowerCase().includes(kw))
})

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
  const text = inputText.value.trim()
  if (!text || !selectedUserId.value) return
  sending.value = true
  try {
    await $fetch(`/api/conversations/${selectedUserId.value}/send`, {
      method: 'POST',
      body: { text },
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

onMounted(loadList)
</script>

<style scoped>
/* ── Sidebar search bar ── */
.conv-search-bar {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

/* Make the sidebar-list container a flex column so search bar stays fixed */
:deep(.split-list-container) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ── Editor header user info ── */
.conv-user-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.conv-avatar {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-pill);
  object-fit: cover;
  flex-shrink: 0;
}

.conv-avatar-placeholder {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-pill);
  background: var(--bg-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.conv-user-id {
  font-size: 0.72rem;
}

/* ── Messages area ── */
.conv-messages {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.conv-bubble-row {
  display: flex;
}

.conv-bubble-row.incoming { justify-content: flex-start; }
.conv-bubble-row.outgoing { justify-content: flex-end; }

.conv-bubble {
  max-width: 65%;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.conv-bubble.incoming {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-bottom-left-radius: var(--radius-xs);
}

.conv-bubble.outgoing {
  background: var(--text-primary);
  color: #fff;
  border-bottom-right-radius: var(--radius-xs);
}

.conv-bubble-text { white-space: pre-wrap; word-break: break-word; }

.conv-bubble-time {
  font-size: 0.65rem;
  align-self: flex-end;
}

.conv-bubble.outgoing .conv-bubble-time {
  color: rgba(255, 255, 255, 0.6);
}

/* ── Input row ── */
.conv-input-row {
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--border);
  background: var(--bg-surface);
  flex-shrink: 0;
}
</style>
