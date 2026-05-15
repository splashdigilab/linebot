import { SLOT_LABELS as ACTION_SLOT_LABELS } from './action-schema'
import {
  RICH_LAYOUT_PRESETS,
  getPresetBoundsPct,
  type RichLayoutId,
} from './rich-layout-presets'
import {
  getRichMessageCanvasSize,
  RICH_MESSAGE_CANVAS_WIDTH,
} from './line-image-spec'

export const RICH_MESSAGE_CANVAS_SIZE = RICH_MESSAGE_CANVAS_WIDTH
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
  tagging?: {
    enabled: boolean
    addTagIds: string[]
  }
  bounds?: RichMessageAreaBounds
}

export function clampRichMessageBounds(
  bounds: RichMessageAreaBounds,
  canvasW = RICH_MESSAGE_CANVAS_SIZE,
  canvasH = RICH_MESSAGE_CANVAS_SIZE,
  minSize = RICH_MESSAGE_MIN_BOUNDS,
): RichMessageAreaBounds {
  const width = Math.max(minSize, Math.min(canvasW, bounds.width))
  const height = Math.max(minSize, Math.min(canvasH, bounds.height))
  const x = Math.max(0, Math.min(canvasW - width, bounds.x))
  const y = Math.max(0, Math.min(canvasH - height, bounds.y))
  return { x, y, width, height }
}

export function presetBoundsToCanvas(
  layoutId: RichLayoutId,
  idx: number,
  canvasW = RICH_MESSAGE_CANVAS_SIZE,
  canvasH = RICH_MESSAGE_CANVAS_SIZE,
): RichMessageAreaBounds {
  const b = getPresetBoundsPct(layoutId, idx)
  return clampRichMessageBounds({
    x: Math.round((b.x / 100) * canvasW),
    y: Math.round((b.y / 100) * canvasH),
    width: Math.round((b.w / 100) * canvasW),
    height: Math.round((b.h / 100) * canvasH),
  }, canvasW, canvasH)
}

export function defaultBoundsByIndex(
  index: number,
  canvasW = RICH_MESSAGE_CANVAS_SIZE,
  canvasH = RICH_MESSAGE_CANVAS_SIZE,
): RichMessageAreaBounds {
  const width = Math.min(320, Math.floor(canvasW * 0.31))
  const height = Math.min(240, Math.floor(canvasH * 0.23))
  const cols = 2
  const gap = 40
  const col = index % cols
  const row = Math.floor(index / cols)
  return {
    x: Math.min(canvasW - width, 120 + col * (width + gap)),
    y: Math.min(canvasH - height, 120 + row * (height + gap)),
    width,
    height,
  }
}

export function newRichMessageAction(
  slot: string,
  index: number,
  withBounds: boolean,
  canvasW = RICH_MESSAGE_CANVAS_SIZE,
  canvasH = RICH_MESSAGE_CANVAS_SIZE,
): RichMessageEditorAction {
  return {
    slot,
    type: 'uri',
    uri: '',
    text: '',
    moduleId: '',
    tagging: { enabled: false, addTagIds: [] },
    ...(withBounds ? { bounds: defaultBoundsByIndex(index, canvasW, canvasH) } : {}),
  }
}

export function createRichMessageActions(
  layoutId: string,
  heroImageWidth?: number,
  heroImageHeight?: number,
): RichMessageEditorAction[] {
  const { width: canvasW, height: canvasH } = getRichMessageCanvasSize(heroImageWidth, heroImageHeight)
  if (layoutId === 'custom') {
    return [newRichMessageAction('A', 0, true, canvasW, canvasH)]
  }
  const count = RICH_LAYOUT_PRESETS.find((item) => item.id === layoutId)?.cells ?? 1
  return ACTION_SLOT_LABELS.slice(0, count).map((slot, idx) =>
    newRichMessageAction(slot, idx, false, canvasW, canvasH),
  )
}

export function normalizeRichMessageActions(
  layoutId: string,
  actions: any[],
  heroImageWidth?: number,
  heroImageHeight?: number,
): RichMessageEditorAction[] {
  const { width: canvasW, height: canvasH } = getRichMessageCanvasSize(heroImageWidth, heroImageHeight)
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
      tagging: {
        enabled: source?.tagging?.enabled === true,
        addTagIds: Array.isArray(source?.tagging?.addTagIds)
          ? source.tagging.addTagIds.map((v: unknown) => String(v || '').trim()).filter(Boolean)
          : [],
      },
      bounds:
        layoutId === 'custom'
          ? clampRichMessageBounds(
              source.bounds || defaultBoundsByIndex(idx, canvasW, canvasH),
              canvasW,
              canvasH,
            )
          : presetBoundsToCanvas(layoutId as RichLayoutId, idx, canvasW, canvasH),
    } as RichMessageEditorAction
  })
}

export function serializeRichMessageActionsForApi(
  layoutId: string,
  actions: RichMessageEditorAction[],
  heroImageWidth?: number,
  heroImageHeight?: number,
) {
  return normalizeRichMessageActions(layoutId, actions, heroImageWidth, heroImageHeight).map((action) => ({
    slot: action.slot,
    type: action.type,
    uri: action.uri,
    text: action.text,
    moduleId: action.moduleId,
    tagging: {
      enabled: action?.tagging?.enabled === true,
      addTagIds: Array.isArray(action?.tagging?.addTagIds)
        ? action.tagging.addTagIds.map((v: unknown) => String(v || '').trim()).filter(Boolean)
        : [],
    },
    ...(layoutId === 'custom' ? { bounds: action.bounds } : {}),
  }))
}

export function richMessageEditorActionsOverlap(actions: RichMessageEditorAction[]): boolean {
  const list = (actions ?? []).map((a) => a.bounds).filter(Boolean) as RichMessageAreaBounds[]
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!
      const b = list[j]!
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
