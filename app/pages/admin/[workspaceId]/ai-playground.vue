<template>
  <AdminSplitLayout solo>
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="AI 客服"
        title="🎮 Playground"
        caption="試答模式：以「真實 LINE 對話」方式測試 AI，不會影響正式對話"
      />
    </template>

    <template #editor-body>
      <div class="pg-body">
        <el-alert
          v-if="aiDisabled"
          class="pg-disabled-alert"
          type="warning"
          show-icon
          :closable="false"
        >
          <template #title>
            AI 自動回覆目前為關閉狀態
          </template>
          <div>
            這裡是試答模式，仍可正常測試。覺得 OK 後請到
            <NuxtLink :to="`/admin/${workspaceId}/ai-settings`">AI 設定</NuxtLink>
            把「啟用 AI 自動回覆」打開，LINE 上才會真的自動回。
          </div>
        </el-alert>

        <!-- ── 對話歷史 ─────────────────────── -->
        <div ref="historyEl" class="pg-chat">
          <p v-if="!history.length" class="pg-chat-empty">
            👋 在下方輸入測試問題，AI 會以「真實 LINE 對話」的方式回應。<br>
            遇到模糊問題會反問並出按鈕，可點選模擬客人回答。
          </p>

          <template v-for="(turn, idx) in history" :key="idx">
            <!-- 客人訊息 -->
            <div v-if="turn.role === 'user'" class="pg-msg pg-msg--user">
              <div class="pg-bubble pg-bubble--user">
                {{ turn.text }}
              </div>
            </div>

            <!-- AI 訊息 -->
            <div v-else class="pg-msg pg-msg--ai">
              <div class="pg-bubble pg-bubble--ai">
                <div class="pg-bubble-head">
                  <span :class="['badge', decisionBadge(turn.result)]">{{ decisionLabel(turn.result) }}</span>
                  <span v-if="turn.result.handoffReason" class="text-xs text-muted">{{ handoffReasonLabel(turn.result) }}</span>
                </div>

                <div v-if="turn.result.decision === 'answered'" class="pg-answer">
                  {{ turn.result.answer }}
                </div>
                <div v-else-if="turn.result.decision === 'disambiguate' && turn.result.disambiguation" class="pg-disambiguate">
                  <p class="pg-clarification">{{ turn.result.disambiguation.clarification }}</p>
                  <div class="pg-option-row">
                    <el-button
                      v-for="opt in turn.result.disambiguation.options"
                      :key="opt.chunkId"
                      size="small"
                      plain
                      :disabled="idx !== latestAiIdx || running"
                      @click="pickOption(opt.title)"
                    >
                      {{ opt.title }}
                    </el-button>
                    <el-button
                      size="small"
                      plain
                      :disabled="idx !== latestAiIdx || running"
                      @click="pickOption('找真人')"
                    >
                      🙋 找真人
                    </el-button>
                  </div>
                  <p v-if="idx !== latestAiIdx" class="text-xs text-muted pg-options-note">
                    （已選過，無法再點）
                  </p>
                </div>
                <div v-else-if="turn.result.handoffReason === 'llm_error'" class="pg-llm-error">
                  <p><strong>💥 AI 服務暫時失敗</strong></p>
                  <p class="text-muted">
                    Gemini 呼叫拋例外（多半是過載 503 或網路抖動）。請<strong>重試</strong>看看；如果持續失敗，到 server log 找
                    <code>[ai-answer] generateText failed</code> 或 <code>embedQuery failed</code> 查實際錯誤。
                  </p>
                  <div class="pg-llm-error-actions">
                    <el-button
                      v-if="idx === latestAiIdx"
                      size="small"
                      type="primary"
                      :disabled="running"
                      @click="retryLast"
                    >
                      🔄 重試上一題
                    </el-button>
                  </div>
                </div>
                <div v-else-if="turn.result.handoffReason === 'manual'" class="pg-skipped">
                  <p>AI 跳過此題。</p>
                  <p class="text-muted">
                    可能原因：query 為空、或 AI 流程被設定中斷。LINE 上不會回任何訊息給客人。
                  </p>
                </div>
                <div v-else class="pg-handoff-notice">
                  <p>本題會自動轉真人客服。</p>
                  <p v-if="turn.result.handoffReason === 'no_grounding'" class="text-muted">
                    知識庫沒有足夠相關內容。建議補一張對應的卡，再試一次。
                  </p>
                  <p v-else-if="turn.result.handoffReason === 'low_confidence'" class="text-muted">
                    AI 找到了卡但把握不足。可以調低信心門檻或補充更精準的卡。
                  </p>
                  <p v-else-if="turn.result.handoffReason === 'sensitive_topic'" class="text-muted">
                    命中敏感主題，依設定直接轉真人。
                  </p>
                  <p v-else-if="turn.result.handoffReason === 'quota_exceeded'" class="text-muted">
                    本月 token 用量已達上限，依設定全部轉真人。
                  </p>
                </div>

                <div class="pg-meta-row">
                  <span class="pg-meta">
                    信心：<strong>{{ turn.result.confidence.toFixed(2) }}</strong>
                  </span>
                  <span class="pg-meta text-muted">
                    （{{ relevantThresholdLabel(turn.result) }} {{ relevantThreshold(turn.result).toFixed(2) }}）
                  </span>
                  <span class="pg-meta text-muted">
                    · 命中 {{ turn.result.sources.length }} 張卡
                  </span>
                  <el-button
                    v-if="turn.result.sources.length || turn.result.debugPrompt"
                    size="small"
                    text
                    class="pg-expand-toggle"
                    @click="turn.expanded = !turn.expanded"
                  >
                    {{ turn.expanded ? '收合詳情' : '展開詳情' }}
                  </el-button>
                </div>

                <div v-if="turn.expanded" class="pg-bubble-details">
                  <div v-if="turn.result.sources.length" class="pg-sources">
                    <div
                      v-for="(src, i) in turn.result.sources"
                      :key="src.chunkId"
                      class="pg-source-row"
                    >
                      <span class="pg-source-rank">#{{ i + 1 }}</span>
                      <span class="pg-source-title">{{ src.title }}</span>
                      <span class="pg-source-score">{{ src.similarity.toFixed(3) }}</span>
                      <el-button size="small" plain @click="goEditChunk(src.chunkId)">編輯</el-button>
                    </div>
                  </div>
                  <details v-if="turn.result.debugPrompt" class="pg-debug">
                    <summary>🔧 Debug：實際送給 LLM 的 prompt</summary>
                    <pre class="pg-debug-pre">{{ turn.result.debugPrompt }}</pre>
                  </details>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- ── 輸入區 ──────────────────────── -->
        <div class="pg-composer">
          <el-input
            v-model="query"
            type="textarea"
            :rows="2"
            :maxlength="500"
            placeholder="例：請問退費要多久才會收到？（⌘+Enter 送出）"
            @keydown.enter.meta.prevent="run"
          />
          <div class="pg-composer-actions">
            <el-button
              type="primary"
              :loading="running"
              :disabled="!query.trim()"
              @click="run"
            >
              {{ running ? 'AI 思考中⋯' : '🚀 送出' }}
            </el-button>
            <el-button
              v-if="history.length"
              plain
              :disabled="running"
              @click="resetConversation"
            >
              新對話
            </el-button>
          </div>
        </div>
      </div>
    </template>
  </AdminSplitLayout>
</template>

<script setup lang="ts">
import {
  HANDOFF_REASON_LABELS,
  type AiAnswerResult,
  type AiSettingsDoc,
} from '~~/shared/types/ai-knowledge'

definePageMeta({ middleware: 'auth', layout: 'default' })

const { apiFetch, workspaceId } = useWorkspace()
const router = useRouter()
const { showToast } = useAdminToast()

type AiResult = AiAnswerResult & { debugPrompt?: string }
type UserTurn = { role: 'user'; text: string }
type AiTurn = { role: 'ai'; result: AiResult; expanded: boolean }
type Turn = UserTurn | AiTurn

const query = ref('')
const running = ref(false)
const history = ref<Turn[]>([])
const confidenceThreshold = ref(0.75)
const groundingThreshold = ref(0.7)
const aiDisabled = ref(false)
const historyEl = ref<HTMLElement | null>(null)

const latestAiIdx = computed(() => {
  for (let i = history.value.length - 1; i >= 0; i--) {
    if (history.value[i]!.role === 'ai') return i
  }
  return -1
})

function decisionLabel(r: AiResult) {
  if (r.decision === 'answered') return '✅ AI 回答'
  if (r.decision === 'disambiguate') return '❓ 反問澄清'
  if (r.handoffReason === 'llm_error') return '💥 AI 服務失敗'
  if (r.handoffReason === 'manual') return '⏸ AI 跳過'
  return '🙋‍♂️ 轉真人'
}

function decisionBadge(r: AiResult) {
  if (r.decision === 'answered') return 'badge-green'
  if (r.decision === 'disambiguate') return 'badge-blue'
  if (r.handoffReason === 'llm_error') return 'badge-red'
  if (r.handoffReason === 'manual') return 'badge-gray'
  return 'badge-orange'
}

function handoffReasonLabel(r: AiResult) {
  return r.handoffReason ? HANDOFF_REASON_LABELS[r.handoffReason] ?? r.handoffReason : ''
}

function relevantThreshold(r: AiResult) {
  return r.handoffReason === 'no_grounding' ? groundingThreshold.value : confidenceThreshold.value
}

function relevantThresholdLabel(r: AiResult) {
  return r.handoffReason === 'no_grounding' ? 'Grounding 門檻' : '信心門檻'
}

async function scrollToBottom() {
  await nextTick()
  const el = historyEl.value
  if (el) el.scrollTop = el.scrollHeight
}

async function send(text: string, opts: { skipDisambiguation?: boolean; isFollowup?: boolean } = {}) {
  const trimmed = text.trim()
  if (!trimmed) return
  history.value.push({ role: 'user', text: trimmed })
  await scrollToBottom()
  running.value = true
  try {
    const res = await apiFetch<AiResult>('/api/ai/playground', {
      method: 'POST',
      body: {
        query: trimmed,
        skipDisambiguation: opts.skipDisambiguation === true,
        isFollowup: opts.isFollowup === true,
      },
    })
    history.value.push({ role: 'ai', result: res, expanded: false })
  }
  catch (err: any) {
    showToast(err?.statusMessage || err?.message || '請求失敗', 'error')
    // 整個 HTTP 都失敗（playground API 本身回 5xx），跟 LLM 失敗同類顯示
    history.value.push({
      role: 'ai',
      result: {
        decision: 'handoff',
        answer: '',
        confidence: 0,
        sources: [],
        handoffReason: 'llm_error',
      },
      expanded: false,
    })
  }
  finally {
    running.value = false
    await scrollToBottom()
  }
}

async function run() {
  const text = query.value
  query.value = ''
  await send(text)
}

async function pickOption(title: string) {
  // 模擬客人點按鈕：跟 LINE handler 一樣帶 skipDisambiguation + isFollowup
  await send(title, { skipDisambiguation: true, isFollowup: true })
}

async function retryLast() {
  // 找最後一個 user turn，把它再送一次（不寫進 history，直接重發 → 替換掉舊的 AI failure）
  let lastUserIdx = -1
  for (let i = history.value.length - 1; i >= 0; i--) {
    if (history.value[i]!.role === 'user') { lastUserIdx = i; break }
  }
  if (lastUserIdx < 0) return
  const lastUser = history.value[lastUserIdx] as UserTurn
  // 把失敗的 AI turn 移除（重試會產生新的）
  if (history.value.length > lastUserIdx + 1 && history.value[lastUserIdx + 1]!.role === 'ai') {
    history.value.splice(lastUserIdx + 1, 1)
  }
  // 也把 user turn 移除（send 會再 push 一次）
  history.value.splice(lastUserIdx, 1)
  await send(lastUser.text)
}

function resetConversation() {
  history.value = []
  query.value = ''
}

function goEditChunk(chunkId: string) {
  // 帶 chunkId 過去；卡片頁會 onMounted 時自動選取該卡開啟編輯
  router.push(`/admin/${workspaceId.value}/knowledge/cards?chunkId=${encodeURIComponent(chunkId)}`)
}

async function loadSettings() {
  try {
    const data = await apiFetch<AiSettingsDoc>('/api/ai/settings')
    confidenceThreshold.value = data.confidenceThreshold
    groundingThreshold.value = data.groundingThreshold
    aiDisabled.value = !data.enabled
  }
  catch { /* 忽略：拿不到就用預設 */ }
}

onMounted(() => loadSettings())
</script>

<style scoped lang="scss">
.pg-body {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: 900px;
  margin: 0 auto;
  padding: 16px;
  box-sizing: border-box;
}

.pg-disabled-alert {
  margin-bottom: 12px;
}

// ─ 對話歷史 ──────────────────────────────
.pg-chat {
  flex: 1;
  overflow-y: auto;
  padding: 8px 4px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pg-chat-empty {
  text-align: center;
  color: var(--el-text-color-secondary);
  padding: 40px 16px;
  line-height: 1.8;
}

.pg-msg {
  display: flex;
  &--user { justify-content: flex-end; }
  &--ai   { justify-content: flex-start; }
}

.pg-bubble {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 12px;
  line-height: 1.6;
  word-break: break-word;
  white-space: pre-wrap;

  &--user {
    background: var(--el-color-primary-light-8);
    color: var(--el-text-color-primary);
    border-bottom-right-radius: 4px;
  }
  &--ai {
    background: var(--el-fill-color-light);
    border: 1px solid var(--el-border-color-lighter);
    border-bottom-left-radius: 4px;
    max-width: 92%;
  }
}

.pg-bubble-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.pg-bubble-details {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--el-border-color-lighter);
}

// ─ 答案 / 反問 / handoff 區塊 ──────────────
.pg-answer {
  padding: 10px 12px;
  background: var(--el-color-success-light-9);
  border-left: 3px solid var(--el-color-success);
  border-radius: 4px;
}

.pg-handoff-notice {
  padding: 10px 12px;
  background: var(--el-color-warning-light-9);
  border-left: 3px solid var(--el-color-warning);
  border-radius: 4px;

  p { margin: 0 0 4px; &:last-child { margin: 0; } }
}

.pg-llm-error {
  padding: 10px 12px;
  background: var(--el-color-danger-light-9);
  border-left: 3px solid var(--el-color-danger);
  border-radius: 4px;

  p { margin: 0 0 4px; &:last-child { margin: 0; } }
  code {
    background: rgba(0, 0, 0, 0.05);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 12px;
  }
}

.pg-llm-error-actions {
  margin-top: 8px;
}

.pg-skipped {
  padding: 10px 12px;
  background: var(--el-fill-color);
  border-left: 3px solid var(--el-text-color-disabled);
  border-radius: 4px;
  color: var(--el-text-color-secondary);

  p { margin: 0 0 4px; &:last-child { margin: 0; } }
}

.pg-disambiguate {
  padding: 10px 12px;
  background: var(--el-color-info-light-9);
  border-left: 3px solid var(--el-color-info);
  border-radius: 4px;
}

.pg-clarification {
  margin: 0 0 8px;
  font-weight: 500;
}

.pg-option-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.pg-options-note {
  margin: 6px 0 0;
}

.pg-meta-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-top: 8px;
  font-size: 12px;
}

.pg-meta strong {
  font-size: 14px;
}

.pg-expand-toggle {
  margin-left: auto;
}

// ─ sources & debug ──────────────────────────
.pg-sources {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pg-source-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: var(--el-fill-color);
  border-radius: 4px;
  font-size: 13px;
}

.pg-source-rank {
  font-weight: 600;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  min-width: 22px;
}

.pg-source-title { flex: 1; font-weight: 500; }
.pg-source-score { color: var(--el-text-color-secondary); font-size: 12px; }

.pg-debug {
  margin-top: 10px;
  summary { cursor: pointer; font-size: 12px; color: var(--el-text-color-secondary); }
}

.pg-debug-pre {
  margin-top: 6px;
  background: var(--el-fill-color-darker);
  padding: 10px;
  border-radius: 4px;
  white-space: pre-wrap;
  font-size: 11px;
  line-height: 1.5;
  max-height: 360px;
  overflow-y: auto;
}

// ─ 輸入區（sticky 底部）─────────────────────
.pg-composer {
  position: sticky;
  bottom: 0;
  background: var(--el-bg-color);
  padding-top: 10px;
  margin-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.pg-composer-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
</style>
