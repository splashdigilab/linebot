/**
 * 將 API JSON 還原後的 Firestore 時間欄位轉成 Date。
 * 支援：Timestamp.toDate()、{ seconds, nanoseconds }、{ _seconds, _nanoseconds }、ISO 字串、毫秒數字。
 */
export function parseFirestoreDate(input: unknown): Date | null {
  if (input == null || input === '') return null
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input
  }
  if (typeof input === 'string') {
    const d = new Date(input)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof input === 'number') {
    const d = input > 1e12 ? new Date(input) : new Date(input * 1000)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof input === 'object') {
    const o = input as Record<string, unknown>
    if (typeof o.toDate === 'function') {
      try {
        const d = (o as { toDate: () => unknown }).toDate()
        if (d instanceof Date && !Number.isNaN(d.getTime())) return d
      }
      catch {
        /* ignore */
      }
    }
    const secRaw = o.seconds ?? o._seconds
    const nanoRaw = o.nanoseconds ?? o._nanoseconds ?? 0
    const sec = typeof secRaw === 'number' ? secRaw : typeof secRaw === 'string' ? Number(secRaw) : NaN
    const nano = typeof nanoRaw === 'number' ? nanoRaw : typeof nanoRaw === 'string' ? Number(nanoRaw) : 0
    if (!Number.isNaN(sec)) {
      const d = new Date(sec * 1000 + (Number.isFinite(nano) ? nano : 0) / 1e6)
      return Number.isNaN(d.getTime()) ? null : d
    }
  }
  return null
}

export function formatZhDateOnly(input: unknown): string {
  const d = parseFirestoreDate(input)
  return d ? d.toLocaleDateString('zh-TW') : '—'
}

export function formatZhDateTime(input: unknown): string {
  const d = parseFirestoreDate(input)
  return d ? d.toLocaleString('zh-TW') : '—'
}
