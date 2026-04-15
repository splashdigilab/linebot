export type AreaEditorBounds = {
  x: number
  y: number
  width: number
  height: number
}

type AreaEditorDragState = {
  type: 'move' | 'resize'
  areaIndex: number
  handle: string
  startClientX: number
  startClientY: number
  startBounds: AreaEditorBounds
}

type AreaEditorGuideLine = { type: 'h' | 'v'; pos: number }

type UseAreaEditorOptions<TArea> = {
  areas: Ref<TArea[]>
  canvasRef: Ref<HTMLElement | null>
  canvasWidth: () => number
  canvasHeight: () => number
  getBounds: (area: TArea) => AreaEditorBounds
  setBounds: (area: TArea, bounds: AreaEditorBounds) => void
  minSize?: number
  snapPx?: number
  enableSnap?: boolean
}

export function useAreaEditor<TArea>(options: UseAreaEditorOptions<TArea>) {
  const dragState = ref<AreaEditorDragState | null>(null)
  const guideLines = ref<AreaEditorGuideLine[]>([])

  const minSize = options.minSize ?? 80
  const snapPx = options.snapPx ?? 8
  const enableSnap = options.enableSnap ?? true

  const overlapSet = computed(() => {
    const result = new Set<number>()
    const areas = options.areas.value
    for (let i = 0; i < areas.length; i++) {
      for (let j = i + 1; j < areas.length; j++) {
        const a = options.getBounds(areas[i])
        const b = options.getBounds(areas[j])
        const overlapping = !(
          a.x + a.width <= b.x ||
          a.x >= b.x + b.width ||
          a.y + a.height <= b.y ||
          a.y >= b.y + b.height
        )
        if (overlapping) {
          result.add(i)
          result.add(j)
        }
      }
    }
    return result
  })

  function clampBounds(bounds: AreaEditorBounds): AreaEditorBounds {
    const widthMax = options.canvasWidth()
    const heightMax = options.canvasHeight()
    const width = Math.max(minSize, Math.min(widthMax, bounds.width))
    const height = Math.max(minSize, Math.min(heightMax, bounds.height))
    const x = Math.max(0, Math.min(widthMax - width, bounds.x))
    const y = Math.max(0, Math.min(heightMax - height, bounds.y))
    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    }
  }

  function clampArea(index: number) {
    const area = options.areas.value[index]
    if (!area) return
    options.setBounds(area, clampBounds(options.getBounds(area)))
  }

  function clampAllAreas() {
    options.areas.value.forEach((_, idx) => clampArea(idx))
  }

  function getSnapXs(excludeIdx: number): number[] {
    const width = options.canvasWidth()
    const pts = [0, width / 2, width]
    options.areas.value.forEach((area, i) => {
      if (i === excludeIdx) return
      const b = options.getBounds(area)
      pts.push(b.x, b.x + b.width)
    })
    return pts
  }

  function getSnapYs(excludeIdx: number): number[] {
    const height = options.canvasHeight()
    const pts = [0, height / 2, height]
    options.areas.value.forEach((area, i) => {
      if (i === excludeIdx) return
      const b = options.getBounds(area)
      pts.push(b.y, b.y + b.height)
    })
    return pts
  }

  function trySnap(val: number, pts: number[], threshold: number): { val: number; pt: number | null; delta: number } {
    let best = { val, pt: null as number | null, delta: Infinity }
    for (const p of pts) {
      const d = Math.abs(val - p)
      if (d < threshold && d < best.delta) best = { val: p, pt: p, delta: d }
    }
    return best
  }

  function getCanvasMetrics() {
    const rect = options.canvasRef.value?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return null
    return {
      rect,
      scaleX: options.canvasWidth() / rect.width,
      scaleY: options.canvasHeight() / rect.height,
    }
  }

  function startDrag(e: MouseEvent, areaIndex: number) {
    const area = options.areas.value[areaIndex]
    if (!area) return
    dragState.value = {
      type: 'move',
      areaIndex,
      handle: '',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBounds: { ...options.getBounds(area) },
    }
  }

  function startResize(e: MouseEvent, areaIndex: number, handle: string) {
    const area = options.areas.value[areaIndex]
    if (!area) return
    dragState.value = {
      type: 'resize',
      areaIndex,
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBounds: { ...options.getBounds(area) },
    }
  }

  function stopDrag() {
    dragState.value = null
    guideLines.value = []
  }

  function onWindowMouseMove(e: MouseEvent) {
    if (!dragState.value) return
    const metrics = getCanvasMetrics()
    if (!metrics) return
    const area = options.areas.value[dragState.value.areaIndex]
    if (!area) return

    const width = options.canvasWidth()
    const height = options.canvasHeight()
    const dx = (e.clientX - dragState.value.startClientX) * metrics.scaleX
    const dy = (e.clientY - dragState.value.startClientY) * metrics.scaleY

    const next = { ...dragState.value.startBounds }
    const guides: AreaEditorGuideLine[] = []

    if (dragState.value.type === 'move') {
      const bw = next.width
      const bh = next.height
      let newX = Math.max(0, Math.min(width - bw, next.x + dx))
      let newY = Math.max(0, Math.min(height - bh, next.y + dy))

      if (enableSnap) {
        const thresholdX = snapPx * metrics.scaleX
        const thresholdY = snapPx * metrics.scaleY
        const snapXs = getSnapXs(dragState.value.areaIndex)
        const snapYs = getSnapYs(dragState.value.areaIndex)

        const leftSnap = trySnap(newX, snapXs, thresholdX)
        const rightSnap = trySnap(newX + bw, snapXs, thresholdX)
        const centerXSnap = trySnap(newX + bw / 2, [width / 2], thresholdX)
        if (leftSnap.pt !== null && leftSnap.delta <= rightSnap.delta) {
          newX = leftSnap.val
          guides.push({ type: 'v', pos: leftSnap.pt })
        } else if (rightSnap.pt !== null) {
          newX = rightSnap.val - bw
          guides.push({ type: 'v', pos: rightSnap.pt })
        } else if (centerXSnap.pt !== null) {
          newX = centerXSnap.val - bw / 2
          guides.push({ type: 'v', pos: centerXSnap.pt })
        }

        const topSnap = trySnap(newY, snapYs, thresholdY)
        const bottomSnap = trySnap(newY + bh, snapYs, thresholdY)
        const centerYSnap = trySnap(newY + bh / 2, [height / 2], thresholdY)
        if (topSnap.pt !== null && topSnap.delta <= bottomSnap.delta) {
          newY = topSnap.val
          guides.push({ type: 'h', pos: topSnap.pt })
        } else if (bottomSnap.pt !== null) {
          newY = bottomSnap.val - bh
          guides.push({ type: 'h', pos: bottomSnap.pt })
        } else if (centerYSnap.pt !== null) {
          newY = centerYSnap.val - bh / 2
          guides.push({ type: 'h', pos: centerYSnap.pt })
        }
      }

      options.setBounds(area, clampBounds({ ...next, x: newX, y: newY }))
      guideLines.value = guides
      return
    }

    const handle = dragState.value.handle
    if (handle.includes('e')) next.width = dragState.value.startBounds.width + dx
    if (handle.includes('s')) next.height = dragState.value.startBounds.height + dy
    if (handle.includes('w')) {
      next.x = dragState.value.startBounds.x + dx
      next.width = dragState.value.startBounds.width - dx
    }
    if (handle.includes('n')) {
      next.y = dragState.value.startBounds.y + dy
      next.height = dragState.value.startBounds.height - dy
    }

    if (enableSnap) {
      const thresholdX = snapPx * metrics.scaleX
      const thresholdY = snapPx * metrics.scaleY
      const snapXs = getSnapXs(dragState.value.areaIndex)
      const snapYs = getSnapYs(dragState.value.areaIndex)

      const leftSnap = trySnap(next.x, snapXs, thresholdX)
      const rightSnap = trySnap(next.x + next.width, snapXs, thresholdX)
      if (leftSnap.pt !== null && handle.includes('w')) {
        const rEdge = next.x + next.width
        next.x = leftSnap.val
        next.width = rEdge - next.x
        guides.push({ type: 'v', pos: leftSnap.pt })
      }
      if (rightSnap.pt !== null && handle.includes('e')) {
        next.width = rightSnap.val - next.x
        guides.push({ type: 'v', pos: rightSnap.pt })
      }

      const topSnap = trySnap(next.y, snapYs, thresholdY)
      const bottomSnap = trySnap(next.y + next.height, snapYs, thresholdY)
      if (topSnap.pt !== null && handle.includes('n')) {
        const bEdge = next.y + next.height
        next.y = topSnap.val
        next.height = bEdge - next.y
        guides.push({ type: 'h', pos: topSnap.pt })
      }
      if (bottomSnap.pt !== null && handle.includes('s')) {
        next.height = bottomSnap.val - next.y
        guides.push({ type: 'h', pos: bottomSnap.pt })
      }
    }

    options.setBounds(area, clampBounds(next))
    guideLines.value = guides
  }

  function bindWindowListeners() {
    window.addEventListener('mousemove', onWindowMouseMove)
    window.addEventListener('mouseup', stopDrag)
  }

  function unbindWindowListeners() {
    window.removeEventListener('mousemove', onWindowMouseMove)
    window.removeEventListener('mouseup', stopDrag)
  }

  return {
    dragState,
    guideLines,
    overlapSet,
    clampBounds,
    clampArea,
    clampAllAreas,
    startDrag,
    startResize,
    stopDrag,
    bindWindowListeners,
    unbindWindowListeners,
  }
}
