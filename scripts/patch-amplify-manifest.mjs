/**
 * 把 prerender 出來的活動入口頁註冊進 Amplify deploy-manifest 靜態路由。
 *
 * 背景:Nitro 的 aws-amplify preset 產生的路由表只有
 *   /_nuxt/* → Static、/*.*（帶副檔名）→ Static、/* → Compute(Lambda)
 * 所以 /liff/lead 這種無副檔名路徑一律打 Lambda——閒置後的冷啟動要 2〜5 秒,
 * 客人點活動網址就是白畫面等待。
 *
 * 此腳本在 build 完成後(amplify.yml build commands 最後一步)執行:
 *   1. 確認 prerender 產物 static/liff/lead.html 存在(nuxt.config 設 prerender
 *      + autoSubfolderIndex:false 才會有)
 *   2. 在 /* 之前插入 { path: '/liff/lead', Static, fallback: Compute }
 * Amplify 靜態層以「路徑 + .html」解析(Next.js 同款行為),命中就 CDN 直出;
 * 萬一解析不了會 fallback 回 Lambda,行為等同未修改,不會壞。
 *
 * 手動驗證:npm run build && node scripts/patch-amplify-manifest.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT_DIR = '.amplify-hosting'
const STATIC_ROUTES = [
  // 活動入口頁(LIFF)。要再加靜態頁時往這個陣列補即可。
  { path: '/liff/lead', staticFile: 'static/liff/lead.html' },
]

const manifestPath = resolve(OUT_DIR, 'deploy-manifest.json')
if (!existsSync(manifestPath)) {
  console.error(`[patch-amplify-manifest] ${manifestPath} 不存在——請先 npm run build`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const routes = Array.isArray(manifest.routes) ? manifest.routes : []
const catchAllIndex = routes.findIndex(r => r?.path === '/*')

let inserted = 0
for (const { path, staticFile } of STATIC_ROUTES) {
  const filePath = resolve(OUT_DIR, staticFile)
  if (!existsSync(filePath)) {
    console.warn(`[patch-amplify-manifest] 略過 ${path}:找不到 ${staticFile}(prerender 未產出?)`)
    continue
  }
  if (routes.some(r => r?.path === path)) {
    console.log(`[patch-amplify-manifest] ${path} 已存在,略過`)
    continue
  }
  const route = {
    path,
    target: { kind: 'Static' },
    fallback: { kind: 'Compute', src: 'default' },
  }
  if (catchAllIndex >= 0) routes.splice(catchAllIndex + inserted, 0, route)
  else routes.push(route)
  inserted++
  console.log(`[patch-amplify-manifest] 已加入靜態路由 ${path} → ${staticFile}`)
}

if (inserted > 0) {
  manifest.routes = routes
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log(`[patch-amplify-manifest] 完成,共插入 ${inserted} 條路由`)
}
else {
  console.log('[patch-amplify-manifest] 無需修改')
}
