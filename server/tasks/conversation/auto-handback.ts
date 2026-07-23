import { autoHandbackIdleSessions } from '~~/server/utils/cron-maintenance'
import { getDb } from '~~/server/utils/firebase'

/**
 * Nitro scheduled task：真人閒置自動交還機器人。
 * 實作本體在 server/utils/cron-maintenance.ts（生產由 /api/cron/run-tasks 觸發——
 * Amplify 不打包 Nitro tasks，此檔只給本機 dev 的 scheduledTasks 用）。
 */
export default defineTask({
  meta: {
    name: 'conversation:auto-handback',
    description: '真人處理中且閒置過久的會話自動交還機器人',
  },
  async run() {
    return { result: await autoHandbackIdleSessions(getDb()) }
  },
})
