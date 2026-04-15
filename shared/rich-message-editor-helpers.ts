import { SLOT_LABELS as ACTION_SLOT_LABELS } from './action-schema'
import {
  RICH_LAYOUT_PRESETS,
  getPresetBoundsPct,
  type RichLayoutId,
} from './rich-layout-presets'

export const RICH_MESSAGE_CANVAS_SIZE = 1040
export const RICH_MESSAGE_MIN_BOUNDS = 80

export type RichMessageActionType = 'uri' | 'message' | 'module'

export type RichMessageAreaBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type RichMessageEditorAction = {
  slot: string
  type: RichMessageActionType
  uri: string
  text: string
  moduleId: string
  bounds?: RichMessageAreaBounds
}

export function clampRichMessageBounds(
  bounds: RichMessageAreaBounds,
  canvas = RICH_MESSAGE_CANVAS_SIZE,
  minSize = RICH_MESSAGE_MIN_BOUNDS,
): RichMessageAreaBounds {
  const width = Math.max(minSize, Math.min(canvas, bounds.width))
  const height = Math.max(minSize, Math.min(canvas, bounds.height))
  const x = Math.max(0, Math.min(canvas - width, bounds.x))
  const y = Math.max(0, Math.min(canvas - height, bounds.y))
  return { x, y, width, height }
}

export function presetBoundsToCanvas(layoutId: RichLayoutId, idx: number): RichMessageAreaBounds {
  const b = getPresetBoundsPct(layoutId, idx)
  return clampRichMessageBounds({
    x: Math.round((b.x / 100) * RICH_MESSAGE_CANVAS_SIZE),
    y: Math.round((b.y / 100) * RICH_MESSAGE_CANVAS_SIZE),
    width: Math.round((b.w / 100) * RICH_MESSAGE_CANVAS_SIZE),
    height: Math.round((b.h / 100) * RICH_MESSAGE_CANVAS_SIZE),
  })
}

export function defaultBoundsByIndex(index: number): RichMessageAreaBounds {
  const width = 320
  const height = 240
  const cols = 2
  const gap = 40
  const col = index % cols
  const row = Math.floor(index / cols)
  return {
    x: 120 + col * (width + gap),
    y: 120 + row * (height + gap),
    width,
    height,
  }
}

export function newRichMessageAction(
  slot: string,
  index: number,
  withBounds: boolean,
): RichMessageEditorAction {
  return {
    slot,
    type: 'uri',
    uri: '',
    text: '',
    moduleId: '',
    ...(withBounds ? { bounds: defaultBoundsByIndex(index) } : {}),
  }
}

export function createRichMessageActions(layoutId: string): RichMessageEditorAction[] {
  if (layoutId === 'custom') {
    return [newRichMessageAction('A', 0, true)]
  }
  const count = RICH_LAYOUT_PRESETS.find((item) => item.id === layoutId)?.cells ?? 1
  return ACTION_SLOT_LABELS.slice(0, count).map((slot, idx) =>
    newRichMessageAction(slot, idx, false),
  )
}

export function normalizeRichMessageActions(
  layoutId: string,
  actions: any[],
): RichMessageEditorAction[] {
  const max =
    layoutId === 'custom'
      ? Math.max(
          1,
          Math.min(ACTION_SLOT_LABELS.length, Array.isArray(actions) ? actions.length : 1),
        )
      : (RICH_LAYOUT_PRESETS.find((item) => item.id === layoutId)?.cells ?? 1)
  const slots = ACTION_SLOT_LABELS.slice(0, max)
  const map = new Map<string, any>()
  for (const action of actions ?? []) {
    if (action?.slot) map.set(String(action.slot), action)
  }
  return slots.map((slot, idx) => {
    const source = map.get(slot) || (Array.isArray(actions) ? actions[idx] : null) || {}
    const type: RichMessageActionType =
      source.type === 'message' || source.type === 'module' ? source.type : 'uri'
    return {
      slot,
      type,
      uri: source.uri || '',
      text: source.text || '',
      moduleId: source.moduleId || '',
      bounds:
        layoutId === 'custom'
          ? clampRichMessageBounds(source.bounds || defaultBoundsByIndex(idx))
          : presetBoundsToCanvas(layoutId as RichLayoutId, idx),
    } as RichMessageEditorAction
  })
}

export function serializeRichMessageActionsForApi(
  layoutId: string,
  actions: RichMessageEditorAction[],
) {
  return normalizeRichMessageActions(layoutId, actions).map((action) => ({
    slot: action.slot,
    type: action.type,
    uri: action.uri,
    text: action.text,
    moduleId: action.moduleId,
    ...(layoutId === 'custom' ? { bounds: action.bounds } : {}),
  }))
}

export function richMessageEditorActionsOverlap(actions: RichMessageEditorAction[]): boolean {
  const list = (actions ?? []).map((a) => a.bounds).filter(Boolean) as RichMessageAreaBounds[]
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      const overlapping = !(
        a.x + a.width <= b.x ||
        a.x >= b.x + b.width ||
        a.y + a.height <= b.y ||
        a.y >= b.y + b.height
      )
      if (overlapping) return true
    }
  }
  return false
}
