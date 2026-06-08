<template>
  <div v-if="ctx?.hasMeta" class="conv-ai-banner" :class="bannerClass">
    <div class="conv-ai-banner-header" @click="expanded = !expanded">
      <span class="conv-ai-banner-badge">{{ decisionEmoji }} AI 脈絡</span>
      <span class="conv-ai-banner-summary">
        {{ summaryText }}
      </span>
      <span class="conv-ai-banner-time">{{ updatedAtLabel }}</span>
      <span class="conv-ai-banner-toggle">{{ expanded ? '▴' : '▾' }}</span>
    </div>

    <div v-if="expanded" class="conv-ai-banner-body">
      <div v-if="ctx.lastQuery" class="conv-ai-row">
        <span class="conv-ai-row__label">客人提問</span>
        <span class="conv-ai-row__value">{{ ctx.lastQuery }}</span>
      </div>

      <div class="conv-ai-row">
        <span class="conv-ai-row__label">信心</span>
        <span class="conv-ai-row__value">
          <strong>{{ ctx.lastConfidence.toFixed(2) }}</strong>
          <span v-if="ctx.lastHandoffReason" class="conv-ai-tag conv-ai-tag--warn">
            {{ handoffLabel }}
          </span>
        </span>
      </div>

      <div v-if="ctx.sources.length" class="conv-ai-row conv-ai-row--block">
        <span class="conv-ai-row__label">命中知識卡（top {{ ctx.sources.length }}）</span>
        <ul class="conv-ai-source-list">
          <li v-for="src in ctx.sources" :key="src.chunkId">{{ src.title }}</li>
        </ul>
      </div>

      <div v-if="ctx.suggestedReply" class="conv-ai-row conv-ai-row--block">
        <span class="conv-ai-row__label">AI 建議回覆</span>
        <div class="conv-ai-draft">{{ ctx.suggestedReply }}</div>
        <el-button size="small" type="primary" plain @click="$emit('apply-draft', ctx.suggestedReply)">
          📝 填入回覆框
        </el-button>
      </div>

      <div v-if="!ctx.suggestedReply && !ctx.sources.length" class="conv-ai-empty">
        知識庫沒有相關資訊。建議到知識庫補一張對應的卡，並把這位客人加入後續追蹤。
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { HANDOFF_REASON_LABELS, type HandoffReason, type AiDecision } from '~~/shared/types/ai-knowledge'

interface AiContextResponse {
  hasMeta: boolean
  lastDecision: AiDecision | ''
  lastConfidence: number
  lastHandoffReason: HandoffReason | null
  lastQuery: string
  suggestedReply: string
  sources: Array<{ chunkId: string; title: string }>
  updatedAtMs: number
}

const props = defineProps<{
  userId: string | null
  /** 父元件 conversations 列表變更時要 trigger 重抓 */
  refreshKey?: number | string
  apiFetch: <T = unknown>(url: string, opts?: Record<string, unknown>) => Promise<T>
}>()

defineEmits<{
  (e: 'apply-draft', text: string): void
}>()

const ctx = ref<AiContextResponse | null>(null)
const expanded = ref(true)

const decisionEmoji = computed(() => {
  if (!ctx.value?.hasMeta) return ''
  if (ctx.value.lastDecision === 'answered') return '✅'
  if (ctx.value.lastDecision === 'handoff') return '🙋‍♂️'
  if (ctx.value.lastDecision === 'disambiguate') return '❓'
  return '💤'
})

const summaryText = computed(() => {
  if (!ctx.value?.hasMeta) return ''
  if (ctx.value.lastDecision === 'answered') return `AI 已回答（信心 ${ctx.value.lastConfidence.toFixed(2)}）`
  if (ctx.value.lastDecision === 'handoff') return `AI 轉真人 — ${handoffLabel.value}`
  if (ctx.value.lastDecision === 'disambiguate') return `AI 反問澄清，等客人從選項挑一個`
  return ctx.value.lastQuery || '—'
})

const handoffLabel = computed(() => {
  const r = ctx.value?.lastHandoffReason
  return r ? HANDOFF_REASON_LABELS[r] ?? r : ''
})

const bannerClass = computed(() => {
  if (!ctx.value?.hasMeta) return ''
  if (ctx.value.lastDecision === 'handoff') return 'conv-ai-banner--handoff'
  if (ctx.value.lastDecision === 'disambiguate') return 'conv-ai-banner--disambiguate'
  return 'conv-ai-banner--answered'
})

const updatedAtLabel = computed(() => {
  const ms = ctx.value?.updatedAtMs ?? 0
  if (!ms) return ''
  return new Date(ms).toLocaleString('zh-TW', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
})

async function load() {
  ctx.value = null
  if (!props.userId) return
  try {
    ctx.value = await props.apiFetch<AiContextResponse>(
      `/api/conversations/${encodeURIComponent(props.userId)}/ai-context`,
    )
  }
  catch {
    ctx.value = null
  }
}

watch(() => [props.userId, props.refreshKey], load, { immediate: true })
</script>

<style scoped lang="scss">
.conv-ai-banner {
  border-radius: 8px;
  margin: 0 12px 12px;
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-light);
  font-size: 13px;

  &--handoff {
    border-color: var(--el-color-warning-light-5);
    background: var(--el-color-warning-light-9);
  }
  &--answered {
    border-color: var(--el-color-success-light-5);
    background: var(--el-color-success-light-9);
  }
  &--disambiguate {
    border-color: var(--el-color-info-light-5);
    background: var(--el-color-info-light-9);
  }
}

.conv-ai-banner-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
}

.conv-ai-banner-badge {
  font-weight: 600;
  white-space: nowrap;
}

.conv-ai-banner-summary {
  flex: 1;
  color: var(--el-text-color-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conv-ai-banner-time,
.conv-ai-banner-toggle {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.conv-ai-banner-body {
  padding: 8px 12px 12px;
  border-top: 1px dashed var(--el-border-color);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conv-ai-row {
  display: flex;
  gap: 8px;
  font-size: 12px;

  &--block {
    flex-direction: column;
  }
}

.conv-ai-row__label {
  min-width: 90px;
  color: var(--el-text-color-secondary);
}

.conv-ai-row__value {
  display: flex;
  align-items: center;
  gap: 8px;
}

.conv-ai-source-list {
  margin: 4px 0 0;
  padding-left: 18px;
  li {
    margin: 2px 0;
  }
}

.conv-ai-draft {
  padding: 8px 10px;
  background: white;
  border-radius: 4px;
  border-left: 3px solid var(--el-color-primary);
  white-space: pre-wrap;
  margin-bottom: 6px;
}

.conv-ai-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;

  &--warn {
    background: var(--el-color-warning-light-7);
    color: var(--el-color-warning-dark-2);
  }
}

.conv-ai-empty {
  color: var(--el-text-color-secondary);
  font-style: italic;
}
</style>
