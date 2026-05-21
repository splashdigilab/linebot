export type AutoReplyMatchType = 'containsAny' | 'containsAll' | 'exact' | 'anyText'
export type AutoReplyActionType = 'module' | 'message' | 'uri'

export interface AutoReplyAction {
  type: AutoReplyActionType
  moduleId: string
  text: string
  uri: string
}

export interface AutoReplyTagging {
  enabled: boolean
  /** 命中此規則時要加上的標籤 IDs */
  addTagIds: string[]
}

/** 同一使用者在冷卻時間內不會重複觸發此規則 */
export interface AutoReplyCooldown {
  enabled: boolean
  /** 冷卻毫秒數，須為 AUTO_REPLY_COOLDOWN_DURATIONS_MS 之一 */
  durationMs: number
}

export const AUTO_REPLY_COOLDOWN_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 60_000, label: '1 分鐘' },
  { value: 3 * 60_000, label: '3 分鐘' },
  { value: 5 * 60_000, label: '5 分鐘' },
  { value: 10 * 60_000, label: '10 分鐘' },
  { value: 15 * 60_000, label: '15 分鐘' },
  { value: 30 * 60_000, label: '30 分鐘' },
  { value: 60 * 60_000, label: '1 小時' },
  { value: 3 * 60 * 60_000, label: '3 小時' },
  { value: 6 * 60 * 60_000, label: '6 小時' },
  { value: 12 * 60 * 60_000, label: '12 小時' },
  { value: 24 * 60 * 60_000, label: '1 天' },
]

export const AUTO_REPLY_COOLDOWN_DURATIONS_MS = AUTO_REPLY_COOLDOWN_OPTIONS.map((o) => o.value)

const DEFAULT_COOLDOWN_DURATION_MS = 60_000

export interface AutoReplyRuleShape {
  id?: string
  name: string
  keyword: string
  matchType: AutoReplyMatchType
  action: AutoReplyAction
  isActive: boolean
  tagging: AutoReplyTagging
  cooldown: AutoReplyCooldown
}

const AUTO_REPLY_MATCH_TYPES: AutoReplyMatchType[] = ['containsAny', 'containsAll', 'exact', 'anyText']
const AUTO_REPLY_ACTION_TYPES: AutoReplyActionType[] = ['module', 'message', 'uri']

function normalizeMatchType(value: unknown): AutoReplyMatchType {
  if (typeof value === 'string' && AUTO_REPLY_MATCH_TYPES.includes(value as AutoReplyMatchType)) {
    return value as AutoReplyMatchType
  }
  return 'exact'
}

function normalizeActionType(value: unknown): AutoReplyActionType {
  if (typeof value === 'string' && AUTO_REPLY_ACTION_TYPES.includes(value as AutoReplyActionType)) {
    return value as AutoReplyActionType
  }
  return 'module'
}

export function normalizeAutoReplyAction(
  rawAction: any,
  fallbackModuleId = '',
): AutoReplyAction {
  const type = normalizeActionType(rawAction?.type)
  return {
    type,
    moduleId: String(rawAction?.moduleId ?? fallbackModuleId ?? '').trim(),
    text: String(rawAction?.text ?? '').trim(),
    uri: String(rawAction?.uri ?? '').trim(),
  }
}

export function normalizeAutoReplyTagging(raw: any): AutoReplyTagging {
  return {
    enabled: raw?.enabled === true,
    addTagIds: Array.isArray(raw?.addTagIds) ? raw.addTagIds.map(String).filter(Boolean) : [],
  }
}

export function normalizeAutoReplyCooldown(raw: any): AutoReplyCooldown {
  const enabled = raw?.enabled === true
  const rawDuration = Number(raw?.durationMs)
  const durationMs = AUTO_REPLY_COOLDOWN_DURATIONS_MS.includes(rawDuration)
    ? rawDuration
    : DEFAULT_COOLDOWN_DURATION_MS
  return { enabled, durationMs }
}

export function normalizeAutoReplyRule(rawRule: any): AutoReplyRuleShape {
  const matchType = normalizeMatchType(rawRule?.matchType)
  return {
    id: rawRule?.id ? String(rawRule.id) : undefined,
    name: String(rawRule?.name ?? '').trim(),
    keyword: String(rawRule?.keyword ?? '').trim(),
    matchType,
    action: normalizeAutoReplyAction(rawRule?.action, String(rawRule?.moduleId ?? '')),
    isActive: rawRule?.isActive !== false,
    tagging: normalizeAutoReplyTagging(rawRule?.tagging),
    cooldown: normalizeAutoReplyCooldown(rawRule?.cooldown),
  }
}

/** 將 Firestore 數值 / Timestamp 轉成 epoch ms */
export function coerceAutoReplyCooldownTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  if (value && typeof value === 'object') {
    const maybeTs = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof maybeTs.toMillis === 'function') {
      const ms = maybeTs.toMillis()
      if (Number.isFinite(ms)) return ms
    }
    const sec = maybeTs.seconds ?? maybeTs._seconds
    if (typeof sec === 'number' && Number.isFinite(sec)) return sec * 1000
  }
  return null
}

export function normalizeAutoReplyCooldownsMap(
  raw: Record<string, unknown> | undefined | null,
): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [ruleId, value] of Object.entries(raw)) {
    const ts = coerceAutoReplyCooldownTimestamp(value)
    if (ts != null) out[ruleId] = ts
  }
  return out
}

export interface AutoReplyModuleCooldownEntry {
  triggeredAt: number
  durationMs: number
}

export function normalizeAutoReplyModuleCooldownsMap(
  raw: Record<string, unknown> | undefined | null,
): Record<string, AutoReplyModuleCooldownEntry> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, AutoReplyModuleCooldownEntry> = {}
  for (const [moduleId, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue
    const triggeredAt = coerceAutoReplyCooldownTimestamp((value as any).triggeredAt)
    const durationMs = Number((value as any).durationMs)
    if (triggeredAt == null || !Number.isFinite(durationMs) || durationMs <= 0) continue
    out[moduleId] = { triggeredAt, durationMs }
  }
  return out
}

export function isAutoReplyModuleOnCooldown(
  moduleId: string,
  moduleCooldowns: Record<string, AutoReplyModuleCooldownEntry> | undefined,
  now = Date.now(),
): boolean {
  const entry = moduleCooldowns?.[moduleId]
  if (!entry) return false
  return entry.triggeredAt + entry.durationMs > now
}

export function isAutoReplyRuleOnCooldown(
  rule: AutoReplyRuleShape,
  lastTriggeredAtByRuleId: Record<string, number> | undefined,
  now = Date.now(),
): boolean {
  if (!rule.cooldown.enabled || !rule.id) return false
  const durationMs = Number(rule.cooldown.durationMs)
  if (!Number.isFinite(durationMs) || durationMs <= 0) return false
  const last = coerceAutoReplyCooldownTimestamp(lastTriggeredAtByRuleId?.[rule.id])
  if (last == null) return false
  return last + durationMs > now
}

export function splitAutoReplyKeywords(keyword: string): string[] {
  return String(keyword || '')
    .split(/[\n,，、\s]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeText(input: string): string {
  return String(input || '').trim().toLocaleLowerCase()
}

export function matchAutoReplyText(rule: AutoReplyRuleShape, inputText: string): boolean {
  const text = normalizeText(inputText)
  if (!text) return false
  if (rule.matchType === 'anyText') return true

  const keyword = normalizeText(rule.keyword)
  if (!keyword) return false
  if (rule.matchType === 'exact') return text === keyword

  const tokens = splitAutoReplyKeywords(keyword)
  if (!tokens.length) return false
  if (rule.matchType === 'containsAll') return tokens.every((token) => text.includes(token))
  return tokens.some((token) => text.includes(token))
}

/** 數字愈小愈優先；避免「輸入任何內容」因建立時間較新而永遠蓋過精準規則 */
const AUTO_REPLY_MATCH_PRIORITY: Record<AutoReplyMatchType, number> = {
  exact: 0,
  containsAll: 1,
  containsAny: 2,
  anyText: 3,
}

/**
 * 從已排序的規則列表（例如依 createdAt 新→舊）中，挑出「最該生效」的一條。
 * 同優先級時保留陣列中較前（較新）者。
 */
export function pickBestMatchingAutoReplyRule(
  rules: AutoReplyRuleShape[],
  inputText: string,
  options: { allowAnyText: boolean; excludeRuleIds?: Set<string> },
): AutoReplyRuleShape | null {
  let best: AutoReplyRuleShape | null = null
  let bestP = 999
  for (const rule of rules) {
    if (rule.id && options.excludeRuleIds?.has(rule.id)) continue
    if (!options.allowAnyText && rule.matchType === 'anyText')
      continue
    if (!matchAutoReplyText(rule, inputText))
      continue
    const p = AUTO_REPLY_MATCH_PRIORITY[rule.matchType]
    if (p < bestP) {
      best = rule
      bestP = p
    }
  }
  return best
}

export function validateAutoReplyRule(rule: AutoReplyRuleShape): string | null {
  if (!rule.name.trim()) return '請輸入規則名稱'
  if (rule.matchType !== 'anyText' && !rule.keyword.trim()) return '請輸入觸發內容'
  if (rule.cooldown.enabled && !AUTO_REPLY_COOLDOWN_DURATIONS_MS.includes(rule.cooldown.durationMs)) {
    return '請選擇有效的冷卻時間'
  }
  if (rule.action.type === 'module' && !rule.action.moduleId) return '請選擇要觸發的機器人模組'
  if (rule.action.type === 'message' && !rule.action.text) return '請輸入回覆文字'
  if (rule.action.type === 'uri' && !rule.action.uri) return '請輸入網址'
  return null
}
