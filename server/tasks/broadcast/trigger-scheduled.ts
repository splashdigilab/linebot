import { runDueScheduledBroadcasts } from '~~/server/utils/run-due-scheduled-broadcasts'

/** Nitro scheduled task（本機 dev 等支援 scheduledTasks 的環境） */
export default defineTask({
  meta: {
    name: 'broadcast:trigger-scheduled',
    description: '發送到期的排程推播',
  },
  async run() {
    const result = await runDueScheduledBroadcasts()
    return { result }
  },
})
