/**
 * 知識庫健檢：掃出「標題＋內容合計（去空白）不足 10 字」的 placeholder / 測試卡。
 * 這類卡（實例：title「小胖」content「5000」）embedding 是雜訊，會以中等相似度
 * 反覆污染檢索與反問澄清候選。與 server/utils/ai-knowledge-chunks.ts 的
 * isChunkTextTooShort / MIN_CHUNK_TEXT_CHARS 同一規則。
 *
 * 預設為 dry-run（只列出不刪）；加 --apply 才實際刪除（並同步 source.chunkCount -1）。
 *   node --env-file=.env_myfeel --experimental-strip-types scripts/scan-short-chunks.ts           # dry-run
 *   node --env-file=.env_myfeel --experimental-strip-types scripts/scan-short-chunks.ts --apply   # 實刪
 *   node --env-file=.env_splash --experimental-strip-types scripts/scan-short-chunks.ts
 */
import { initializeApp, cert } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const apply = process.argv.includes('--apply')

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY

if (!projectId || !clientEmail || !privateKey) {
  console.error('缺少環境變數：FIREBASE_PROJECT_ID、FIREBASE_CLIENT_EMAIL、FIREBASE_PRIVATE_KEY')
  process.exit(1)
}

initializeApp({
  credential: cert({ projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') }),
})

const MIN_CHUNK_TEXT_CHARS = 10

function isChunkTextTooShort(title: string, content: string): boolean {
  const compact = (String(title ?? '') + String(content ?? '')).replace(/\s+/g, '')
  return compact.length < MIN_CHUNK_TEXT_CHARS
}

async function main() {
  const db = getFirestore()
  console.log(`[scan-short-chunks] project=${projectId} mode=${apply ? 'APPLY（會刪除）' : 'DRY-RUN'}`)

  const snap = await db.collection('knowledgeChunks').select('workspaceId', 'title', 'content', 'sourceId').get()
  let scanned = 0
  let matched = 0
  let deleted = 0

  for (const doc of snap.docs) {
    scanned++
    const data = doc.data() as Record<string, unknown>
    const title = String(data.title ?? '')
    const content = String(data.content ?? '')
    if (!isChunkTextTooShort(title, content)) continue

    matched++
    console.log(`  過短卡 chunk=${doc.id} ws=${data.workspaceId} source=${data.sourceId ?? '-'} title=「${title}」content=「${content.slice(0, 50)}」`)

    if (apply) {
      await doc.ref.delete()
      if (typeof data.sourceId === 'string' && data.sourceId) {
        await db.collection('knowledgeSources').doc(data.sourceId)
          .update({ chunkCount: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() })
          .catch(() => {}) // source 可能已被刪，忽略
      }
      deleted++
    }
  }

  console.log(`[scan-short-chunks] scanned=${scanned} matched=${matched} deleted=${deleted}${apply ? '' : '（dry-run 未刪，加 --apply 實刪）'}`)
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
