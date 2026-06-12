<template>
  <AdminSplitLayout solo>
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="AI 客服"
        title="⚙️ AI 設定"
        caption="調整 AI 自動回覆的開關、模型、信心 / Grounding 門檻、quota 與敏感詞"
      />
      <div class="flex gap-1 admin-header-actions">
        <el-button :disabled="!dirty" @click="loadSettings(true)">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="!dirty" @click="save">儲存設定</el-button>
      </div>
    </template>

    <template #editor-body>
      <div class="solo-editor-body admin-panel-stack">
        <!-- ── 總開關 ─────────────────────────── -->
        <div class="message-card ai-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🔌 總開關</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ai-section-hint">關掉之後 AI 不接任何訊息；規則／腳本不受影響。</p>
            <div class="admin-field-group">
              <AdminFieldLabel text="啟用 AI 自動回覆" tight />
              <el-switch
                v-model="form.enabled"
                active-text="啟用"
                inactive-text="停用"
              />
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="回覆模式" tight />
              <el-radio-group v-model="form.replyMode" :disabled="!form.enabled">
                <el-radio value="auto">全自動（AI 直接回覆客人）</el-radio>
                <el-radio value="draft">草稿（AI 只給客服建議回覆，不回覆客人）</el-radio>
              </el-radio-group>
              <p class="ai-section-hint">
                建議新導入時先用「草稿」跑一到兩週：AI 的建議回覆會出現在「對話」頁的 AI 脈絡區塊，
                由客服一鍵帶入回覆框。確認答題品質穩定後再切「全自動」。
              </p>
            </div>
          </div>
        </div>

        <!-- ── 模型 ──────────────────────────── -->
        <div class="message-card ai-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🤖 模型</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div class="admin-field-group">
              <AdminFieldLabel text="回答模型" tight />
              <el-select v-model="form.answerModel" class="control-full">
                <el-option label="Gemini 2.5 Flash（推薦）" value="gemini-2.5-flash" />
                <el-option label="Gemini 2.5 Flash Lite（更省）" value="gemini-2.5-flash-lite" />
              </el-select>
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="Embedding 模型" tight />
              <el-select v-model="form.embeddingModel" class="control-full" disabled>
                <el-option label="gemini-embedding-001（768 dim）" value="gemini-embedding-001" />
              </el-select>
              <p class="ai-section-hint">換 embedding 模型會導致現有所有卡的索引失效，目前不開放切換。</p>
            </div>
          </div>
        </div>

        <!-- ── 信心門檻 ──────────────────────── -->
        <div class="message-card ai-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🎯 信心門檻</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ai-section-hint">
              低於此門檻 AI 會放棄回答、轉真人客服。建議 <strong>0.75 起手</strong>，跑兩週後依數據再降。
            </p>
            <div class="admin-field-group">
              <AdminFieldLabel text="快速套用組合" tight />
              <div class="flex gap-1">
                <el-button size="small" plain @click="applyPreset('strict')">🛡 嚴格（少答多轉真人）</el-button>
                <el-button size="small" plain @click="applyPreset('balanced')">⚖️ 平衡（預設）</el-button>
                <el-button size="small" plain @click="applyPreset('loose')">🚀 寬鬆（多答少轉）</el-button>
              </div>
              <p class="ai-section-hint">會同時調整信心 / Grounding 門檻與反問澄清區間，按「儲存設定」才生效。</p>
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel :text="`信心門檻：${form.confidenceThreshold.toFixed(2)}`" tight />
              <el-slider
                v-model="form.confidenceThreshold"
                :min="0"
                :max="1"
                :step="0.05"
                show-stops
              />
            </div>
          </div>
        </div>

        <!-- ── Grounding 門檻 ────────────────── -->
        <div class="message-card ai-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">📚 Grounding 門檻</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ai-section-hint">
              最佳知識卡的相似度需 ≥ 此值才允許 AI 回答；否則直接轉真人（標 <code>no_grounding</code>）。
              預設 <strong>0.7</strong>。常出現 <code>0.65–0.69</code> 擦邊 case 可以調低一點。
            </p>
            <div class="admin-field-group">
              <AdminFieldLabel :text="`Grounding 門檻：${form.groundingThreshold.toFixed(2)}`" tight />
              <el-slider
                v-model="form.groundingThreshold"
                :min="0"
                :max="1"
                :step="0.05"
                show-stops
              />
            </div>
          </div>
        </div>

        <!-- ── 系統提示 ──────────────────────── -->
        <div class="message-card ai-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">📝 系統提示（語氣 / 禁則）</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ai-section-hint">給 AI 的指示：講話口吻、不能說什麼、要怎麼處理特殊狀況。</p>
            <el-input
              v-model="form.systemPrompt"
              type="textarea"
              :rows="8"
              :maxlength="4000"
              show-word-limit
            />
            <div class="admin-field-group">
              <AdminFieldLabel :text="`回覆長度上限：${form.replyMaxLen} 字`" tight />
              <el-slider
                v-model="form.replyMaxLen"
                :min="50"
                :max="1000"
                :step="50"
              />
            </div>
          </div>
        </div>

        <!-- ── Quota ─────────────────────────── -->
        <div class="message-card ai-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">💰 用量上限</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div class="admin-field-group">
              <AdminFieldLabel text="月 token 上限" tight />
              <el-input-number
                v-model="form.quota.monthlyTokenCap"
                :min="0"
                :max="100000000"
                :step="100000"
                controls-position="right"
                class="control-full"
              />
              <p class="ai-section-hint">含 input / output / embedding 全部 token。設 0 表示不限制。</p>
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="超量處理" tight />
              <el-radio-group v-model="form.quota.onExceed">
                <el-radio value="handoff_all">全部轉真人（保守、推薦）</el-radio>
                <el-radio value="downgrade_model">降級為 Flash Lite（服務不中斷）</el-radio>
              </el-radio-group>
            </div>
          </div>
        </div>

        <!-- ── 轉真人通知 ─────────────────────── -->
        <div class="message-card ai-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🔔 轉真人通知</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ai-section-hint">
              AI 或腳本把對話轉給真人時，用官方帳號推播 LINE 訊息提醒以下客服人員。
              收通知的人必須已加這個官方帳號為好友；同一位客人 10 分鐘內只通知一次。
            </p>
            <div class="admin-field-group">
              <AdminFieldLabel text="啟用通知" tight />
              <el-switch
                v-model="form.handoffNotify.enabled"
                active-text="啟用"
                inactive-text="停用"
              />
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="通知對象（LINE userId，最多 10 位）" tight />
              <div class="ai-tag-row">
                <el-tag
                  v-for="uid in form.handoffNotify.lineUserIds"
                  :key="uid"
                  closable
                  class="ai-tag"
                  @close="removeNotifyUser(uid)"
                >
                  {{ uid }}
                </el-tag>
                <el-input
                  v-if="notifyInputVisible"
                  ref="notifyInputEl"
                  v-model="notifyInput"
                  size="small"
                  class="ai-tag-input"
                  placeholder="Uxxxxxxxx…"
                  @keydown.enter.prevent="commitNotifyUser"
                  @blur="commitNotifyUser"
                />
                <el-button
                  v-else
                  size="small"
                  plain
                  :disabled="!form.handoffNotify.enabled || form.handoffNotify.lineUserIds.length >= 10"
                  @click="showNotifyInput"
                >
                  ＋ 新增
                </el-button>
              </div>
              <p class="ai-section-hint">可至「用戶」頁找到該客服人員（需先加官方帳號好友並傳過訊息），複製其 LINE userId（U 開頭）。</p>
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="超時再提醒（分鐘，0 = 關閉）" tight />
              <el-input-number
                v-model="form.handoffNotify.slaRemindMinutes"
                :min="0"
                :max="1440"
                :step="5"
                :disabled="!form.handoffNotify.enabled"
              />
              <p class="ai-section-hint">
                轉真人後超過此時間仍無人回覆，再推播提醒一次（每場會話只提醒一次）。
              </p>
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="真人閒置自動交還機器人（分鐘，0 = 關閉）" tight />
              <el-input-number
                v-model="form.handbackIdleMinutes"
                :min="0"
                :max="1440"
                :step="5"
              />
              <p class="ai-section-hint">
                真人接手後若超過此時間沒有再回覆，系統自動把會話交還機器人，AI / 自動回覆恢復接手，
                避免真人忘記收尾時客人後續訊息沒人理。也可在「對話」頁手動點「交還機器人」。
              </p>
            </div>
          </div>
        </div>

        <!-- ── 反問澄清 ──────────────────────── -->
        <div class="message-card ai-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">❓ 反問澄清</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ai-section-hint">
              客人問題太籠統、知識庫有多張卡都接近時，主動反問請客人點按鈕澄清，而不是硬答或直接轉真人。
            </p>
            <div class="admin-field-group">
              <AdminFieldLabel text="啟用反問澄清" tight />
              <el-switch
                v-model="form.disambiguation.enabled"
                active-text="啟用"
                inactive-text="停用"
              />
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel :text="`觸發區間下限（top1 ≥）：${form.disambiguation.top1Min.toFixed(2)}`" tight />
              <el-slider
                v-model="form.disambiguation.top1Min"
                :min="0"
                :max="1"
                :step="0.05"
                :disabled="!form.disambiguation.enabled"
                show-stops
              />
              <p class="ai-section-hint">top-1 相似度低於此值就不反問（太低 = 知識庫沒料，照常 grounding）。</p>
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel :text="`觸發區間上限（top1 <）：${form.disambiguation.top1Max.toFixed(2)}`" tight />
              <el-slider
                v-model="form.disambiguation.top1Max"
                :min="0"
                :max="1"
                :step="0.05"
                :disabled="!form.disambiguation.enabled"
                show-stops
              />
              <p class="ai-section-hint">top-1 相似度高於此值就不反問（夠肯定 = 直接答）。</p>
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel :text="`Top1−Top2 差距小於：${form.disambiguation.maxSpread.toFixed(2)}`" tight />
              <el-slider
                v-model="form.disambiguation.maxSpread"
                :min="0"
                :max="0.3"
                :step="0.01"
                :disabled="!form.disambiguation.enabled"
              />
              <p class="ai-section-hint">差距小於此值才算「多卡同樣相關」，值越大越容易觸發反問。</p>
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="最多選項數" tight />
              <el-input-number
                v-model="form.disambiguation.maxOptions"
                :min="2"
                :max="5"
                :disabled="!form.disambiguation.enabled"
                controls-position="right"
              />
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="冷卻時間（分鐘）" tight />
              <el-input-number
                v-model="form.disambiguation.cooldownMinutes"
                :min="0"
                :max="1440"
                :disabled="!form.disambiguation.enabled"
                controls-position="right"
              />
              <p class="ai-section-hint">同一對話內，反問之間至少間隔多久。設 0 表示不限。</p>
            </div>
          </div>
        </div>

        <!-- ── 敏感詞 ─────────────────────────── -->
        <div class="message-card ai-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">⚠️ 敏感詞</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ai-section-hint">命中以下任一關鍵字，AI 一律不答、直接轉真人。子字串比對。</p>
            <div class="ai-tag-row">
              <el-tag
                v-for="topic in form.sensitiveTopics"
                :key="topic"
                closable
                class="ai-tag"
                @close="removeSensitive(topic)"
              >
                {{ topic }}
              </el-tag>
              <el-input
                v-if="sensitiveInputVisible"
                ref="sensitiveInputEl"
                v-model="sensitiveInput"
                size="small"
                class="ai-tag-input"
                @keydown.enter.prevent="commitSensitive"
                @blur="commitSensitive"
              />
              <el-button v-else size="small" plain @click="showSensitiveInput">＋ 新增</el-button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </AdminSplitLayout>
</template>

<script setup lang="ts">
import type { AiSettingsDoc } from '~~/shared/types/ai-knowledge'

definePageMeta({ middleware: ['auth', 'ai-feature'], layout: 'default' })

const { apiFetch } = useWorkspace()
const { showToast } = useAdminToast()

interface FormShape {
  enabled: boolean
  replyMode: AiSettingsDoc['replyMode']
  answerModel: AiSettingsDoc['answerModel']
  embeddingModel: AiSettingsDoc['embeddingModel']
  confidenceThreshold: number
  groundingThreshold: number
  systemPrompt: string
  replyMaxLen: number
  sensitiveTopics: string[]
  quota: { monthlyTokenCap: number; onExceed: AiSettingsDoc['quota']['onExceed'] }
  handoffNotify: AiSettingsDoc['handoffNotify']
  handbackIdleMinutes: number
  disambiguation: AiSettingsDoc['disambiguation']
}

function defaultForm(): FormShape {
  return {
    enabled: false,
    replyMode: 'auto',
    answerModel: 'gemini-2.5-flash',
    embeddingModel: 'gemini-embedding-001',
    confidenceThreshold: 0.75,
    groundingThreshold: 0.7,
    systemPrompt: '',
    replyMaxLen: 300,
    sensitiveTopics: [],
    quota: { monthlyTokenCap: 1_000_000, onExceed: 'handoff_all' },
    handoffNotify: { enabled: false, lineUserIds: [], slaRemindMinutes: 15 },
    handbackIdleMinutes: 0,
    disambiguation: {
      enabled: true,
      top1Min: 0.65,
      top1Max: 0.78,
      maxSpread: 0.05,
      maxOptions: 3,
      cooldownMinutes: 5,
    },
  }
}

const form = ref<FormShape>(defaultForm())
const saving = ref(false)
const { markClean, hasUnsavedChanges: dirty } = useUnsavedChanges({
  getSnapshot: () => form.value,
})

/**
 * 門檻 preset：非工程背景的管理者沒有依據逐項調 RAG 參數，提供三檔起手組合。
 * 嚴格 = 寧可轉真人也不要答錯；寬鬆 = 知識庫成熟後拉高自動回覆率。
 */
function applyPreset(name: 'strict' | 'balanced' | 'loose') {
  const presets = {
    strict: { conf: 0.8, grounding: 0.75, top1Min: 0.7, top1Max: 0.82 },
    balanced: { conf: 0.75, grounding: 0.7, top1Min: 0.65, top1Max: 0.78 },
    loose: { conf: 0.65, grounding: 0.6, top1Min: 0.55, top1Max: 0.7 },
  } as const
  const ps = presets[name]
  form.value.confidenceThreshold = ps.conf
  form.value.groundingThreshold = ps.grounding
  form.value.disambiguation.top1Min = ps.top1Min
  form.value.disambiguation.top1Max = ps.top1Max
}

const sensitiveInput = ref('')
const sensitiveInputVisible = ref(false)
const sensitiveInputEl = ref<{ focus: () => void } | null>(null)

function showSensitiveInput() {
  sensitiveInputVisible.value = true
  nextTick(() => sensitiveInputEl.value?.focus())
}

function commitSensitive() {
  const t = sensitiveInput.value.trim()
  if (t && !form.value.sensitiveTopics.includes(t)) {
    form.value.sensitiveTopics = [...form.value.sensitiveTopics, t]
  }
  sensitiveInput.value = ''
  sensitiveInputVisible.value = false
}

function removeSensitive(topic: string) {
  form.value.sensitiveTopics = form.value.sensitiveTopics.filter(t => t !== topic)
}

const notifyInput = ref('')
const notifyInputVisible = ref(false)
const notifyInputEl = ref<{ focus: () => void } | null>(null)

function showNotifyInput() {
  notifyInputVisible.value = true
  nextTick(() => notifyInputEl.value?.focus())
}

function commitNotifyUser() {
  const id = notifyInput.value.trim()
  if (id && !form.value.handoffNotify.lineUserIds.includes(id) && form.value.handoffNotify.lineUserIds.length < 10) {
    form.value.handoffNotify.lineUserIds = [...form.value.handoffNotify.lineUserIds, id]
  }
  notifyInput.value = ''
  notifyInputVisible.value = false
}

function removeNotifyUser(uid: string) {
  form.value.handoffNotify.lineUserIds = form.value.handoffNotify.lineUserIds.filter(u => u !== uid)
}

async function loadSettings(_resetOnly = false) {
  try {
    const data = await apiFetch<AiSettingsDoc>('/api/ai/settings')
    form.value = {
      enabled: data.enabled,
      replyMode: data.replyMode === 'draft' ? 'draft' : 'auto',
      answerModel: data.answerModel,
      embeddingModel: data.embeddingModel,
      confidenceThreshold: data.confidenceThreshold,
      groundingThreshold: data.groundingThreshold,
      systemPrompt: data.systemPrompt,
      replyMaxLen: data.replyMaxLen,
      sensitiveTopics: [...data.sensitiveTopics],
      quota: { ...data.quota },
      handoffNotify: {
        enabled: data.handoffNotify?.enabled === true,
        lineUserIds: [...(data.handoffNotify?.lineUserIds ?? [])],
        slaRemindMinutes: Number(data.handoffNotify?.slaRemindMinutes ?? 15),
      },
      handbackIdleMinutes: Number(data.handbackIdleMinutes ?? 0),
      disambiguation: { ...data.disambiguation },
    }
    markClean()
  }
  catch (err: any) {
    showToast(err?.statusMessage || '載入設定失敗', 'error')
  }
}

async function save() {
  saving.value = true
  try {
    await apiFetch('/api/ai/settings', { method: 'PUT', body: form.value })
    showToast('已儲存 ✅', 'success')
    markClean()
  }
  catch (err: any) {
    showToast(err?.statusMessage || '儲存失敗', 'error')
  }
  finally {
    saving.value = false
  }
}

onMounted(() => loadSettings())
</script>

<style scoped lang="scss">
.ai-section-card {
  margin-bottom: 0; // gap 由 .admin-panel-stack 控制
}

.ai-section-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 0 0 8px;
}

.ai-tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.ai-tag {
  margin: 0;
}

.ai-tag-input {
  width: 140px;
}
</style>
