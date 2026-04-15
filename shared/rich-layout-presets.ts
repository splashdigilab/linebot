export type RichLayoutId = 'custom' | 'single' | 'splitV' | 'splitH' | 'grid4' | 'tripleH' | 'mix3' | 'grid6'

export interface RichLayoutPreset {
  id: RichLayoutId
  label: string
  cells: number
}

type BoundsPct = { x: number; y: number; w: number; h: number }

export const RICH_LAYOUT_PRESETS: RichLayoutPreset[] = [
  { id: 'custom', label: '自訂區域', cells: 1 },
  { id: 'single', label: '滿版', cells: 1 },
  { id: 'splitV', label: '左右', cells: 2 },
  { id: 'splitH', label: '上下', cells: 2 },
  { id: 'grid4', label: '四宮格', cells: 4 },
  { id: 'tripleH', label: '三橫列', cells: 3 },
  { id: 'mix3', label: '上1下2', cells: 3 },
  { id: 'grid6', label: '六宮格', cells: 6 },
]

export const PRESET_BOUNDS_PCT: Record<Exclude<RichLayoutId, 'custom'>, BoundsPct[]> = {
  single: [{ x: 0, y: 0, w: 100, h: 100 }],
  splitV: [{ x: 0, y: 0, w: 50, h: 100 }, { x: 50, y: 0, w: 50, h: 100 }],
  splitH: [{ x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 50, w: 100, h: 50 }],
  grid4: [
    { x: 0, y: 0, w: 50, h: 50 },
    { x: 50, y: 0, w: 50, h: 50 },
    { x: 0, y: 50, w: 50, h: 50 },
    { x: 50, y: 50, w: 50, h: 50 },
  ],
  tripleH: [
    { x: 0, y: 0, w: 100, h: 33.33 },
    { x: 0, y: 33.33, w: 100, h: 33.33 },
    { x: 0, y: 66.67, w: 100, h: 33.33 },
  ],
  mix3: [
    { x: 0, y: 0, w: 100, h: 50 },
    { x: 0, y: 50, w: 50, h: 50 },
    { x: 50, y: 50, w: 50, h: 50 },
  ],
  grid6: [
    { x: 0, y: 0, w: 33.33, h: 50 },
    { x: 33.33, y: 0, w: 33.33, h: 50 },
    { x: 66.67, y: 0, w: 33.33, h: 50 },
    { x: 0, y: 50, w: 33.33, h: 50 },
    { x: 33.33, y: 50, w: 33.33, h: 50 },
    { x: 66.67, y: 50, w: 33.33, h: 50 },
  ],
}

export function getPresetBoundsPct(layoutId: RichLayoutId, index: number): BoundsPct {
  if (layoutId === 'custom') return { x: 0, y: 0, w: 100, h: 100 }
  return PRESET_BOUNDS_PCT[layoutId]?.[index] ?? { x: 0, y: 0, w: 100, h: 100 }
}

export function createPresetBounds(layoutId: RichLayoutId, width: number, height: number): Array<{ x: number; y: number; width: number; height: number }> {
  if (layoutId === 'custom') return []
  const list = PRESET_BOUNDS_PCT[layoutId] ?? PRESET_BOUNDS_PCT.single
  return list.map((item) => ({
    x: Math.round((item.x / 100) * width),
    y: Math.round((item.y / 100) * height),
    width: Math.round((item.w / 100) * width),
    height: Math.round((item.h / 100) * height),
  }))
}
