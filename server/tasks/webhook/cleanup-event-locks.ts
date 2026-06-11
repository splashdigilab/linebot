import { Timestamp } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { WEBHOOK_EVENT_LOCKS_COLLECTION } from '~~/server/utils/webhook-dedup'

/**
 * Nitro scheduled task：刪除過期的 webhook 冪等鎖（expiresAt < now）。
 * Firestore TTL policy 也會清（splash 已設定），此任務作為不依賴 console 權限的保底。
 * 排程於 nuxt.config.ts scheduledTasks（每小時）。
 */
export default defineTask({
  meta: {
    name: 'webhook:cleanup-event-locks',
    description: '清理過期的 webhook 事件冪等鎖',
  },
  async run() {
    const db = getDb()
    let deleted = 0
    // 每輪最多清 5 批（2500 筆），避免單次任務跑太久；剩餘的留給下一輪
    for (let i = 0; i < 5; i++) {
      const snap = await db.collection(WEBHOOK_EVENT_LOCKS_COLLECTION)
        .where('expiresAt', '<', Timestamp.now())
        .limit(500)
        .get()
      if (snap.empty) break
      const batch = db.batch()
      snap.docs.forEach(doc => batch.delete(doc.ref))
      await batch.commit()
      deleted += snap.size
      if (snap.size < 500) break
    }
    if (deleted > 0) {
      console.log('[webhook:cleanup-event-locks] deleted', deleted, 'expired locks')
    }
    return { result: { deleted } }
  },
})
