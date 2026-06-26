<template>
  <AdminSplitLayout solo>
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="AI 客服"
        title="⚙️ AI 設定"
        caption="開關、回覆模式、語氣與轉真人規則;細部參數收在最下方「進階調校」"
      />
      <div class="flex gap-1 admin-header-actions">
        <el-button :disabled="!dirty" @click="loadSettings(true)">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="!dirty" data-tour="ais-save" @click="save">儲存設定</el-button>
      </div>
    </template>

    <template #editor-body>
      <div class="solo-editor-body admin-panel-stack">
        <!-- ── 目前狀態 ───────────────────────── -->
        <div class="message-card ai-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🚦 目前狀態</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div class="ai-status-row">
              <span :class="['badge', statusBadgeClass]">{{ statusLabel }}</span>
              <span v-if="usageTokens !== null" class="ai-status-usage">
                本月用量 {{ formatTokens(usageTokens) }}<template v-if="form.quota.monthlyTokenCap > 0"> / {{ formatTokens(form.quota.monthlyTokenCap) }}</template> tokens
              </span>
              <NuxtLink :to="`/admin/${workspaceId}/ai-usage`" class="ai-status-link">用量監控 →</NuxtLink>
            </div>
            <el-progress
              v-if="quotaPct !== null"
              :percentage="quotaPct"
              :stroke-width="8"
              :status="quotaPct >= 90 ? 'exception' : quotaPct >= 70 ? 'warning' : undefined"
            />
            <div v-if="showChecklist" class="ai-checklist">
              <p class="ai-section-hint ai-checklist-title">上線前建議完成:</p>
              <div class="ai-check-item">
                <span>{{ kbReady ? '✅' : '⬜' }}</span>
                <span>知識庫有內容(目前 {{ cardCount ?? '—' }} 張卡)</span>
                <NuxtLink :to="`/admin/${workspaceId}/knowledge/sources`" class="ai-status-link">去補知識 →</NuxtLink>
              </div>
              <div class="ai-check-item">
                <span>{{ notifyReady ? '✅' : '⬜' }}</span>
                <span>設定轉真人通知(AI 答不了時才有人即時接手)</span>
              </div>
              <div class="ai-check-item">
                <span>💡</span>
                <span>到「測試對話」試答幾題,確認 AI 答得對再上線;先用「草稿」模式跑一兩週更穩</span>
                <NuxtLink :to="`/admin/${workspaceId}/ai-playground`" class="ai-status-link">去測試 →</NuxtLink>
              </div>
            </div>
          </div>
        </div>

        <!-- ── 總開關 ─────────────────────────── -->
        <div class="message-card ai-section-card" data-tour="ais-toggle">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🔌 總開關</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ai-section-hint">關掉之後 AI 不接任何訊息;規則/腳本不受影響。</p>
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
                <el-radio value="auto">全自動(AI 直接回覆客人)</el-radio>
                <el-radio value="draft">草稿(AI 只給客服建議回覆,不回覆客人)</el-radio>
              </el-radio-group>
              <p class="ai-section-hint">
                建議新導入時先用「草稿」跑一到兩週:AI 的建議回覆會出現在「對話」頁的 AI 脈絡區塊,
                由客服一鍵帶入回覆框。確認答題品質穩定後再切「全自動」。
              </p>
            </div>
          </div>
        </div>

        <!-- ── 回答風格 ──────────────────────── -->
        <div class="message-card ai-section-card" data-tour="ais-style">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🎯 回答風格</span>
              <span v-if="!activePreset" class="badge badge-gray">已自訂</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ai-section-hint">
              決定 AI「多有把握才開口」。拿不準的問題一律轉真人客服,不會亂答。
            </p>
            <el-radio-group :model-value="activePreset" class="ai-preset-group" @update:model-value="onPresetChange">
              <el-radio value="strict">
                🛡 嚴格 — 寧可轉真人也不答錯,適合知識庫剛起步
              </el-radio>
              <el-radio value="balanced">
                ⚖️ 平衡 — 預設,適合多數情況
              </el-radio>
              <el-radio value="loose">
                🚀 寬鬆 — 多答少轉,適合知識庫成熟、答題已穩定
              </el-radio>
            </el-radio-group>
            <p v-if="!activePreset" class="ai-section-hint">
              目前門檻是在「進階調校」手動調整過的組合;點任一風格會覆蓋回預設組合。
            </p>
          </div>
        </div>

        <!-- ── 系統提示 ──────────────────────── -->
        <div class="message-card ai-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">📝 語氣與禁則</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ai-section-hint">給 AI 的指示:講話口吻、不能說什麼、要怎麼處理特殊狀況。不知道怎麼寫?先套一個範本再改:</p>
            <div class="flex gap-1 ai-tone-row">
              <el-button size="small" plain @click="applyToneTemplate('friendly')">😊 親切活潑</el-button>
              <el-button size="small" plain @click="applyToneTemplate('professional')">💼 專業簡潔</el-button>
              <el-button size="small" plain @click="applyToneTemplate('warm')">🤝 溫暖體貼</el-button>
            </div>
            <el-input
              v-model="form.systemPrompt"
              type="textarea"
              :rows="8"
              :maxlength="4000"
              show-word-limit
              placeholder="例:你是品牌的線上客服,語氣親切簡潔。只根據知識庫內容回答,不確定就轉真人客服…"
            />
          </div>
        </div>

        <!-- ── 商店網址 ──────────────────────── -->
        <div class="message-card ai-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🔗 商店 / 官網網址</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ai-section-hint">
              客人問價格 / 購買、但知識卡裡沒有對應連結時,AI 會用這個網址回覆「最新價格與購買請見…」。留空則不啟用。
            </p>
            <el-input
              v-model="form.shopUrl"
              :maxlength="500"
              placeholder="https://your-shop.example.com/"
              clearable
            />
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
              AI 或腳本把對話轉給真人時,用官方帳號推播 LINE 訊息提醒以下客服人員。
              收通知的人必須已加這個官方帳號為好友;同一位客人 10 分鐘內只通知一次。
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
              <AdminFieldLabel text="通知對象(最多 10 位)" tight />
              <el-select
                v-model="form.handoffNotify.lineUserIds"
                multiple
                filterable
                remote
                allow-create
                default-first-option
                :remote-method="searchNotifyUsers"
                :loading="notifySearchLoading"
                :multiple-limit="10"
                :disabled="!form.handoffNotify.enabled"
                placeholder="輸入暱稱搜尋會員…"
                class="control-full"
                @change="syncNotifyDisplayNames"
              >
                <el-option
                  v-for="opt in notifyUserOptions"
                  :key="opt.id"
                  :value="opt.id"
                  :label="opt.name"
                >
                  <span>{{ opt.name }}</span>
                  <span class="ai-notify-option-id">{{ opt.id }}</span>
                </el-option>
              </el-select>
              <p class="ai-section-hint">
                輸入客服人員在 LINE 上的暱稱搜尋(對方需已加這個官方帳號好友並傳過訊息);
                也可直接貼上 U 開頭的 LINE userId 後按 Enter。
              </p>
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="超時再提醒(分鐘,0 = 關閉)" tight />
              <el-input-number
                v-model="form.handoffNotify.slaRemindMinutes"
                :min="0"
                :max="1440"
                :step="5"
                :disabled="!form.handoffNotify.enabled"
              />
              <p class="ai-section-hint">
                轉真人後超過此時間仍無人回覆,再推播提醒一次(每場會話只提醒一次)。
              </p>
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="真人閒置自動交還機器人(分鐘,0 = 關閉)" tight />
              <el-input-number
                v-model="form.handbackIdleMinutes"
                :min="0"
                :max="1440"
                :step="5"
              />
              <p class="ai-section-hint">
                真人接手後若超過此時間沒有再回覆,系統自動把會話交還機器人,AI / 自動回覆恢復接手,
                避免真人忘記收尾時客人後續訊息沒人理。也可在「對話」頁手動點「交還機器人」。
              </p>
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
            <p class="ai-section-hint">命中以下任一關鍵字,AI 一律不答、直接轉真人。子字串比對。</p>
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

        <!-- ── 進階調校(預設收合)──────────────── -->
        <button type="button" class="ai-advanced-toggle" @click="showAdvanced = !showAdvanced">
          <span class="ai-advanced-toggle__arrow">{{ showAdvanced ? '▾' : '▸' }}</span>
          🛠 進階調校
          <span class="ai-advanced-toggle__sub">門檻、反問澄清、用量上限{{ isSuperAdmin ? '、模型' : '' }} — 一般情況用上方「回答風格」即可</span>
        </button>

        <template v-if="showAdvanced">
          <!-- 門檻 / 回答行為 -->
          <div class="message-card ai-section-card">
            <div class="message-card-header">
              <div class="card-header-main">
                <span class="badge badge-green">🎯 回答行為調校</span>
              </div>
            </div>
            <div class="card-section-stack">
              <p class="ai-section-hint">
                手動調整後,上方「回答風格」會顯示「已自訂」。按「儲存設定」才生效。
              </p>
              <div class="admin-field-group">
                <AdminFieldLabel :text="`信心門檻:${form.confidenceThreshold.toFixed(2)}`" tight />
                <el-slider
                  v-model="form.confidenceThreshold"
                  :min="0"
                  :max="1"
                  :step="0.05"
                  show-stops
                />
                <p class="ai-section-hint">低於此門檻 AI 會放棄回答、轉真人客服。建議 0.75 起手,跑兩週後依數據再降。</p>
              </div>
              <div class="admin-field-group">
                <AdminFieldLabel :text="`知識庫相關度門檻(Grounding):${form.groundingThreshold.toFixed(2)}`" tight />
                <el-slider
                  v-model="form.groundingThreshold"
                  :min="0"
                  :max="1"
                  :step="0.05"
                  show-stops
                />
                <p class="ai-section-hint">
                  最佳知識卡的相似度需 ≥ 此值才允許 AI 回答;否則直接轉真人(標 <code>no_grounding</code>)。
                  預設 0.7,常出現 0.65–0.69 擦邊 case 可以調低一點。
                </p>
              </div>
              <div class="admin-field-group">
                <AdminFieldLabel :text="`回覆長度上限:${form.replyMaxLen} 字`" tight />
                <el-slider
                  v-model="form.replyMaxLen"
                  :min="50"
                  :max="1000"
                  :step="50"
                />
              </div>
            </div>
          </div>

          <!-- 反問澄清 -->
          <div class="message-card ai-section-card">
            <div class="message-card-header">
              <div class="card-header-main">
                <span class="badge badge-green">❓ 反問澄清</span>
              </div>
            </div>
            <div class="card-section-stack">
              <p class="ai-section-hint">
                客人問題太籠統、知識庫有多張卡都接近時,主動反問請客人點按鈕澄清,而不是硬答或直接轉真人。
                觸發區間由「回答風格」帶入,通常不需手動調整。
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
                <AdminFieldLabel :text="`觸發區間下限(top1 ≥):${form.disambiguation.top1Min.toFixed(2)}`" tight />
                <el-slider
                  v-model="form.disambiguation.top1Min"
                  :min="0"
                  :max="1"
                  :step="0.05"
                  :disabled="!form.disambiguation.enabled"
                  show-stops
                />
                <p class="ai-section-hint">top-1 相似度低於此值就不反問(太低 = 知識庫沒料,照常 grounding)。</p>
              </div>
              <div class="admin-field-group">
                <AdminFieldLabel :text="`觸發區間上限(top1 <):${form.disambiguation.top1Max.toFixed(2)}`" tight />
                <el-slider
                  v-model="form.disambiguation.top1Max"
                  :min="0"
                  :max="1"
                  :step="0.05"
                  :disabled="!form.disambiguation.enabled"
                  show-stops
                />
                <p class="ai-section-hint">top-1 相似度高於此值就不反問(夠肯定 = 直接答)。</p>
              </div>
              <div class="admin-field-group">
                <AdminFieldLabel :text="`Top1−Top2 差距小於:${form.disambiguation.maxSpread.toFixed(2)}`" tight />
                <el-slider
                  v-model="form.disambiguation.maxSpread"
                  :min="0"
                  :max="0.3"
                  :step="0.01"
                  :disabled="!form.disambiguation.enabled"
                />
                <p class="ai-section-hint">差距小於此值才算「多卡同樣相關」,值越大越容易觸發反問。</p>
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
                <AdminFieldLabel text="冷卻時間(分鐘)" tight />
                <el-input-number
                  v-model="form.disambiguation.cooldownMinutes"
                  :min="0"
                  :max="1440"
                  :disabled="!form.disambiguation.enabled"
                  controls-position="right"
                />
                <p class="ai-section-hint">同一對話內,反問之間至少間隔多久。設 0 表示不限。</p>
              </div>
            </div>
          </div>

          <!-- Quota -->
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
                <p class="ai-section-hint">
                  含 input / output / embedding 全部 token。設 0 表示不限制。
                  <template v-if="usageTokens !== null">本月已用 {{ formatTokens(usageTokens) }} tokens。</template>
                </p>
              </div>
              <div class="admin-field-group">
                <AdminFieldLabel text="超量處理" tight />
                <el-radio-group v-model="form.quota.onExceed">
                  <el-radio value="handoff_all">全部轉真人(保守、推薦)</el-radio>
                  <el-radio value="downgrade_model">降級為 Flash Lite(服務不中斷)</el-radio>
                </el-radio-group>
              </div>
            </div>
          </div>

          <!-- 模型(僅 super admin)-->
          <div v-if="isSuperAdmin" class="message-card ai-section-card">
            <div class="message-card-header">
              <div class="card-header-main">
                <span class="badge badge-green">🤖 模型</span>
                <span class="badge badge-gray">僅系統管理員可見</span>
              </div>
            </div>
            <div class="card-section-stack">
              <div class="admin-field-group">
                <AdminFieldLabel text="回答模型" tight />
                <el-select v-model="form.answerModel" class="control-full">
                  <el-option label="Gemini 2.5 Flash(推薦)" value="gemini-2.5-flash" />
                  <el-option label="Gemini 2.5 Flash Lite(更省)" value="gemini-2.5-flash-lite" />
                </el-select>
                <p class="ai-section-hint">
                  Embedding 模型固定為 gemini-embedding-001(768 dim);切換會使所有知識卡索引失效,不開放調整。
                </p>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </AdminSplitLayout>
</template>

<script setup lang="ts">
import { ElMessageBox } from 'element-plus'
import type { AiSettingsDoc } from '~~/shared/types/ai-knowledge'

definePageMeta({ middleware: ['auth', 'ai-feature'], layout: 'default' })

const { apiFetch, workspaceId } = useWorkspace()
const { showToast } = useAdminToast()
const { isSuperAdmin, checkIsSuperAdmin } = useSuperAdmin()

interface FormShape {
  enabled: boolean
  replyMode: AiSettingsDoc['replyMode']
  answerModel: AiSettingsDoc['answerModel']
  embeddingModel: AiSettingsDoc['embeddingModel']
  confidenceThreshold: number
  groundingThreshold: number
  systemPrompt: string
  shopUrl: string
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
    shopUrl: '',
    replyMaxLen: 300,
    sensitiveTopics: [],
    quota: { monthlyTokenCap: 1_000_000, onExceed: 'handoff_all' },
    handoffNotify: { enabled: false, lineUserIds: [], displayNames: {}, slaRemindMinutes: 15 },
    handbackIdleMinutes: 0,
    disambiguation: {
      enabled: true,
      // 與後端 DEFAULT_DISAMBIGUATION_TOP1_MIN 一致(0.70）：低於此的多卡群多半是
      // 「沒有好答案被迫湊近似卡」,反問會塞不相關選項。改這裡記得同步後端常數。
      top1Min: 0.7,
      top1Max: 0.78,
      maxSpread: 0.05,
      maxOptions: 3,
      cooldownMinutes: 5,
    },
  }
}

const form = ref<FormShape>(defaultForm())
const saving = ref(false)
const showAdvanced = ref(false)
const { markClean, hasUnsavedChanges: dirty } = useUnsavedChanges({
  getSnapshot: () => form.value,
})

/**
 * 門檻 preset:非工程背景的管理者沒有依據逐項調 RAG 參數,基本層只露出三檔風格;
 * 個別 slider 收在「進階調校」。嚴格 = 寧可轉真人也不要答錯;寬鬆 = 知識庫成熟後拉高自動回覆率。
 */
type PresetName = 'strict' | 'balanced' | 'loose'

const PRESETS: Record<PresetName, { conf: number; grounding: number; top1Min: number; top1Max: number }> = {
  strict: { conf: 0.8, grounding: 0.75, top1Min: 0.7, top1Max: 0.82 },
  balanced: { conf: 0.75, grounding: 0.7, top1Min: 0.7, top1Max: 0.78 },
  loose: { conf: 0.65, grounding: 0.6, top1Min: 0.55, top1Max: 0.7 },
}

const activePreset = computed<PresetName | ''>(() => {
  const eq = (a: number, b: number) => Math.abs(a - b) < 0.001
  for (const [name, ps] of Object.entries(PRESETS) as Array<[PresetName, typeof PRESETS.strict]>) {
    if (
      eq(form.value.confidenceThreshold, ps.conf)
      && eq(form.value.groundingThreshold, ps.grounding)
      && eq(form.value.disambiguation.top1Min, ps.top1Min)
      && eq(form.value.disambiguation.top1Max, ps.top1Max)
    ) return name
  }
  return ''
})

function applyPreset(name: PresetName) {
  const ps = PRESETS[name]
  form.value.confidenceThreshold = ps.conf
  form.value.groundingThreshold = ps.grounding
  form.value.disambiguation.top1Min = ps.top1Min
  form.value.disambiguation.top1Max = ps.top1Max
}

// el-radio-group 的 update 事件型別較寬,模板內不能用 as 轉型,包一層
function onPresetChange(value: string | number | boolean | undefined) {
  if (value === 'strict' || value === 'balanced' || value === 'loose') applyPreset(value)
}

// ── 語氣範本:解決「空白 textarea 不知道寫什麼」 ──────────
const TONE_TEMPLATES = {
  friendly: `你是品牌的線上客服,語氣親切、活潑、有溫度,像朋友一樣聊天,可以適度使用表情符號。
回答要簡短好讀,先講重點再補充細節。
只根據知識庫內容回答;不確定的事不要猜,直接說會請真人客服協助。
不主動承諾退費、賠償或時程;涉及個資只引導客人到官方管道處理。`,
  professional: `你是品牌的線上客服,語氣專業、有禮、精準,不使用表情符號。
回答控制在三句話內,先給結論,必要時條列步驟。
只根據知識庫內容回答;沒有依據時不要推測,直接轉真人客服。
不代表公司做出任何承諾(退費、賠償、時程);涉及帳號或個資一律轉真人。`,
  warm: `你是品牌的線上客服,語氣溫暖、有同理心,先回應客人的感受再處理問題。
遇到抱怨或不滿,先道歉並表達理解,再說明能協助的部分。
只根據知識庫內容回答;答不出來就坦白說明並轉真人客服。
不做退費、賠償等承諾;敏感或情緒激動的情況盡快轉真人。`,
} as const

async function applyToneTemplate(name: keyof typeof TONE_TEMPLATES) {
  const next = TONE_TEMPLATES[name]
  const current = form.value.systemPrompt.trim()
  if (current && current !== next) {
    try {
      await ElMessageBox.confirm('套用範本會覆蓋目前的系統提示內容,確定嗎?', '套用語氣範本', {
        confirmButtonText: '覆蓋',
        cancelButtonText: '取消',
        type: 'warning',
      })
    }
    catch { return }
  }
  form.value.systemPrompt = next
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

// ── 目前狀態面板:讓「調整設定」跟「現在是什麼狀態」在同一頁 ──
const usageTokens = ref<number | null>(null)
const cardCount = ref<number | null>(null)

const statusLabel = computed(() => {
  if (!form.value.enabled) return '⚪ AI 已停用'
  return form.value.replyMode === 'draft' ? '🟡 草稿模式運作中(不會自動回客人)' : '🟢 全自動運作中'
})

const statusBadgeClass = computed(() => {
  if (!form.value.enabled) return 'badge-gray'
  return form.value.replyMode === 'draft' ? 'badge-yellow' : 'badge-green'
})

const quotaPct = computed(() => {
  const cap = form.value.quota.monthlyTokenCap
  if (usageTokens.value === null || cap <= 0) return null
  return Math.min(100, Math.round((usageTokens.value / cap) * 100))
})

const kbReady = computed(() => (cardCount.value ?? 0) > 0)
const notifyReady = computed(() => form.value.handoffNotify.enabled && form.value.handoffNotify.lineUserIds.length > 0)
const showChecklist = computed(() => !form.value.enabled || !kbReady.value || !notifyReady.value)

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

async function loadStatus() {
  const now = new Date()
  const period = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const [usage, sources] = await Promise.allSettled([
    apiFetch<{ inputTokens: number; outputTokens: number; embeddingTokens: number }>(`/api/ai/usage/summary?period=${period}`),
    apiFetch<{ items: Array<{ chunkCount: number }> }>('/api/ai/sources/list'),
  ])
  if (usage.status === 'fulfilled') {
    usageTokens.value = (usage.value.inputTokens ?? 0) + (usage.value.outputTokens ?? 0) + (usage.value.embeddingTokens ?? 0)
  }
  if (sources.status === 'fulfilled') {
    cardCount.value = sources.value.items.reduce((sum, s) => sum + (s.chunkCount ?? 0), 0)
  }
}

// ── 通知對象選人器:用會員暱稱搜尋,免去手抄 LINE userId ──
const notifySearchLoading = ref(false)
const notifySearchResults = ref<Array<{ id: string; displayName: string }>>([])
// userId → 暱稱(已儲存的 displayNames + 搜尋結果累積),讓已選 tag 顯示名字而不是 Uxxxx
const knownUserNames = ref<Record<string, string>>({})

const notifyUserOptions = computed(() => {
  const map = new Map<string, string>()
  for (const uid of form.value.handoffNotify.lineUserIds) {
    map.set(uid, knownUserNames.value[uid] || uid)
  }
  for (const u of notifySearchResults.value) {
    map.set(u.id, u.displayName || u.id)
  }
  return [...map.entries()].map(([id, name]) => ({ id, name }))
})

async function searchNotifyUsers(query: string) {
  const q = query.trim()
  if (!q) {
    notifySearchResults.value = []
    return
  }
  notifySearchLoading.value = true
  try {
    const res = await apiFetch<{ users: Array<{ id: string; displayName: string }> }>(
      `/api/users/list?search=${encodeURIComponent(q)}&limit=20`,
    )
    notifySearchResults.value = res.users.map(u => ({ id: u.id, displayName: u.displayName }))
    for (const u of res.users) {
      if (u.displayName) knownUserNames.value[u.id] = u.displayName
    }
  }
  catch {
    notifySearchResults.value = []
  }
  finally {
    notifySearchLoading.value = false
  }
}

function syncNotifyDisplayNames() {
  const names: Record<string, string> = {}
  for (const uid of form.value.handoffNotify.lineUserIds) {
    const name = knownUserNames.value[uid]
    if (name) names[uid] = name
  }
  form.value.handoffNotify.displayNames = names
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
      shopUrl: data.shopUrl ?? '',
      replyMaxLen: data.replyMaxLen,
      sensitiveTopics: [...data.sensitiveTopics],
      quota: { ...data.quota },
      handoffNotify: {
        enabled: data.handoffNotify?.enabled === true,
        lineUserIds: [...(data.handoffNotify?.lineUserIds ?? [])],
        displayNames: { ...(data.handoffNotify?.displayNames ?? {}) },
        slaRemindMinutes: Number(data.handoffNotify?.slaRemindMinutes ?? 15),
      },
      handbackIdleMinutes: Number(data.handbackIdleMinutes ?? 0),
      disambiguation: { ...data.disambiguation },
    }
    // 回填名稱快取,讓已選通知對象的 tag 顯示暱稱
    for (const [uid, name] of Object.entries(data.handoffNotify?.displayNames ?? {})) {
      if (name) knownUserNames.value[uid] = name
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

onMounted(() => {
  loadSettings()
  loadStatus()
  checkIsSuperAdmin().catch(() => {})
})
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

.ai-preset-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.ai-tone-row {
  margin-bottom: 8px;
}

.ai-advanced-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--el-text-color-regular);
  text-align: left;

  &:hover {
    background: var(--el-fill-color-light);
  }

  &__arrow {
    color: var(--el-text-color-secondary);
  }

  &__sub {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
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

.ai-notify-option-id {
  float: right;
  margin-left: 12px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.ai-status-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 4px;
}

.ai-status-usage {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.ai-status-link {
  font-size: 12px;
  color: var(--el-color-primary);
  text-decoration: none;
  white-space: nowrap;

  &:hover { text-decoration: underline; }
}

.ai-checklist {
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
}

.ai-checklist-title {
  font-weight: 600;
}

.ai-check-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  padding: 3px 0;
  line-height: 1.6;
}
</style>
