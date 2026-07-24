// Element Plus 命令式彈窗（ElMessageBox / ElMessage / ElNotification / ElLoading）
// 修正「後開的 modal 壓在前一個 modal 底下」的 z-index 疊放錯亂。
//
// 成因：Element Plus 的 z-index 由一個共用計數器管理（useZIndex → nextZIndex）。
// 用 app.use(ElementPlus) 全量安裝時，安裝流程會替這些命令式 API 設定
//   fn._context = app._context
// 讓它們跟著整個 app 走，共用同一個 ZINDEX_INJECTION_KEY 計數器。
// 但 @element-plus/nuxt 走的是「自動 import 單一元件」，不會呼叫 app.use，
// 於是 _context 一直是 null。結果：
//   • <el-dialog>（元件）→ inject 到 nuxt 模組 provide 的計數器 A
//   • ElMessageBox 等（命令式，appContext=null）→ fallback 到模組內建計數器 B
// A、B 各自遞增、互不相干。當某個 dialog 正開著（用了較大的 A 值），
// 再從裡面叫出 ElMessageBox（拿到較小的 B 值）時，彈窗 z-index 反而更低，
// 就被壓在 dialog 底下 —— 也就是回報的症狀。
//
// 修法：補上原本 app.use 會做的事，把 app context 掛回這些命令式 API，
// 讓它們與 <el-dialog> 共用同一個 z-index 計數器。順帶也讓它們正確繼承
// 全域設定（locale 等）。
import { ElMessage, ElMessageBox, ElNotification, ElLoading } from 'element-plus'

export default defineNuxtPlugin((nuxtApp) => {
  const context = (nuxtApp.vueApp as any)._context

  ;(ElMessage as any)._context = context
  ;(ElMessageBox as any)._context = context
  ;(ElNotification as any)._context = context
  ;(ElLoading.service as any)._context = context
})
