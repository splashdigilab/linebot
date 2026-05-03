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

export interface AutoReplyRuleShape {
  id?: string
  name: string
  keyword: string
  matchType: AutoReplyMatchType
  action: AutoReplyAction
  isActive: boolean
  tagging: AutoReplyTagging
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
  }
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
  options: { allowAnyText: boolean },
): AutoReplyRuleShape | null {
  let best: AutoReplyRuleShape | null = null
  let bestP = 999
  for (const rule of rules) {
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
  if (rule.action.type === 'module' && !rule.action.moduleId) return '請選擇要觸發的機器人模組'
  if (rule.action.type === 'message' && !rule.action.text) return '請輸入回覆文字'
  if (rule.action.type === 'uri' && !rule.action.uri) return '請輸入網址'
  return null
}
