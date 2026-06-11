/**
 * 把 in-memory Map 快取的大小壓在上限內（超過就先進先出淘汰最舊 entry）。
 *
 * 用途：以 userId / uid 為 key 的快取會隨活躍用戶數無上限成長，
 * 在長駐實例上累積成記憶體洩漏。Map 的迭代順序即插入順序，
 * 從頭刪除等於 FIFO——對 TTL 快取而言最舊的本來就最接近過期，夠用了。
 * 在每次 set 之後呼叫。
 */
export function capMapSize(map: Map<unknown, unknown>, maxEntries: number): void {
  while (map.size > maxEntries) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}
