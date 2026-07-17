# UI/UX 審查待辦（依優先順序）

> 建立：2026-07-16。審查範圍：全 30 頁（入口/登入/超管/LIFF、核心營運、AI 客服、Flow/圖文選單、設定/計費/組織）。
> 進度：已完成 R2、R3、R5(badge/btn hover)、item 7、8、9、12、20、29、31、33，item 38 的 aria 兩項、
> item 34 的 .cmp-stat-rate；每批皆 `nuxt typecheck` 通過。R2/R3/R5/多數 P1 已 commit 到 billing-anchored-period。
> 排序原則：**先修「一改就同時修好很多頁」的根因**，再修「會流失名單／誤刪心血」的，
> 再修「明顯瑕疵與一致性破綻」，最後才是打磨。
> 標記：`[ ]` 未做、`[x] ✅` 已完成。UI＝畫面美感/視覺一致，UX＝流程順暢/資訊清楚。

---

## 🔑 第 0 順位 — 五個根因（最高槓桿，先修這五項會一次消掉下面約半數單頁項目）

1. [ ] **狀態色被灰階化（R1）** — UI
   `element-variables.scss` + `core/_variables.scss` 把 `success/warning/danger/info` 全設成相近深灰
   （#404040 / #525252 / #262626 / #737373）。結果「靠顏色分辨狀態」在全站普遍失效：
   付款成功/失敗、角色標籤、訂閱狀態、對話狀態橫幅、KPI 卡、標籤啟用/停用、推播 failed、
   flow 訊息類型、super 全部 el-tag、進度條…幾乎每一頁都中。
   **修法**：保留一組「不吃單色化」的語意色 token（可比照 org-flag 已用的真彩綠/橙/紅）；
   需要區分處一律用**顏色＋圖示＋文字**三重編碼，別只靠已被抹平的 hue。

2. [x] ✅ **確認框兩套並行、破壞性動作保護不足（R2）** — UX　（2026-07-16 完成）
   已把 13 處原生 `confirm()` 全部改為 `ElMessageBox.confirm` + `confirmButtonClass: 'el-button--danger'`
   （campaigns/auto-reply/support-presets/richmenu/flow 刪除、broadcasts 取消、members/super 移除、
   organization 清憑證、super 停用組織、super 授予/撤銷 Super Admin）。`useUnsavedChanges.ts` 的
   `window.confirm` 刻意保留（beforeunload 同步守衛，ElMessageBox 為非同步無法替代）。
   **殘留**：授予 Super Admin 的「輸入 email 比對」更強二次確認尚未做（另列為加強項）。

3. [x] ✅ **觀察者（viewer）唯讀只做一半（R3）** — UX ＋ 權限漏洞　（2026-07-17 完成）
   6 頁（users/tags/campaigns/auto-reply/broadcasts/support-presets）全部：
   - 引入 `const { canOperate, assertCanOperate } = useAdminOperateGuard()`。
   - 每個寫入函式（submit/delete/sync/batch/addTag/removeTag/saveDraft/confirmSchedule/confirmSendNow/cancel）開頭加 `assertCanOperate()`（防呆＋提示）；broadcasts 的自動輪詢 `processDueScheduledBroadcasts` 用靜默 `canOperate.value` 擋。
   - 所有寫入鈕（新增/儲存/刪除/批次/同步/移標✕）加 `v-if="canOperate"`，對 viewer 直接隱藏（符合「無權限一律隱藏」）。
   `nuxt typecheck` 通過。

4. [ ] **全站沒有手機版（R4）** — UX/UI
   `.layout-wrapper` 固定 flex + 240px 側欄 + `overflow:hidden`，**無漢堡、無抽屜**（grep 全站無 toggle/drawer/collapse）；
   41 個 SCSS 只有 10 個有 media query。兩大編輯器（flow/richmenu）拖曳只綁 `mousedown` + window `mousemove`
   （`useAreaEditor.ts:272`，無 pointer/touch），觸控裝置完全無法操作、且無「請用電腦」提示。
   **修法**：≤900px 時側欄改抽屜 + 頂部漢堡；編輯器改 pointer events，或在窄寬顯示攔截提示；
   LIFF 頁（手機 webview）另見第 21 項。

5. [ ] **殘留樣式與未定義 class（R5）** — UI　（部分完成）
   - [x] ✅ `.badge-yellow` / `.badge-purple` **已補定義**（`_badges.scss`），不再渲染成無底透明。
   - [x] ✅ `.btn-secondary:hover` 白邊 `rgba(255,255,255,.15)` **已改** `var(--border-active)`。
   - [ ] `.btn-danger` 仍是 `rgba(0,0,0,.1)` 底 + 近黑字 → **危險按鈕不像危險**（待 R1 狀態色 token 一起給真紅）。
   - [ ] 殘留非灰階舊色未清：綠 `rgba(6,199,85)`（flow 拖放暈影、layout active）、藍 `#8bb6ff`（版型縮圖框）、
     藍 `#eef3fb`/`#1f5fae`（對話頁 active）、紫 `#9b59b6`（stats handoff）、綠 fallback `#0f7b54`/`#06c755`（見第 42 項）。

---

## 🔴 第 1 順位 — 立即修（名單流失／不可復原誤刪）

6. [ ] **Landing 預約 Demo 表單是假的** — UX　`pages/index.vue:367`
   `@submit.prevent="submitted = true"` 只設本地變數、**沒有任何 API 送出**，卻立刻顯示
   「收到了！我們會在 1 個工作天內聯繫」。所有 hero/pricing/CTA 都導到這張表單
   → **每一筆潛在客戶都石沉大海，還被告知已收到。**
   **修法**：接真正的 lead 端點（或至少 mailto/第三方表單），送出失敗顯示錯誤而非假成功。

7. [x] ✅ **flow 刪整卡/整欄無確認無 undo** — UX　（2026-07-16 完成）
   `removeMessage`（訊息卡 ✕）與新增的 `removeColumn`（輪播欄 ✕，取代 3 處 inline `msg.columns.splice`）
   都改為 `ElMessageBox.confirm` + danger。
   **殘留**：單一按鈕/快速回覆的小 ✕ 刻意不加確認（易重建、加確認反而擾民）；如要更保險可改做 undo toast。

---

## 🟠 第 2 順位 — 盡快改（明顯瑕疵／一致性破綻／關鍵資訊看不清）

### 跨頁共通
8. [x] ✅ **結束會話無確認** — UX　（2026-07-16 完成）：`AdminPanel.closeSelectedSession` 加上 `ElMessageBox.confirm`（並說明「下次來訊視為新會話」）。
9. [x] ✅ **字面 `**markdown**` 外洩** — UI　（2026-07-16 完成）：knowledge/sources 三處 hint 的 `**…**` 已改成 `<strong>…</strong>`。

### index.vue（Landing）
10. [ ] 表單 `novalidate` 且無驗證，姓名/聯絡方式可全空白送出仍成功；聯絡方式欄 `type="text"` 手機不跳對應鍵盤 — UX。
    附帶：`<select>` 產業別/需求無空白預設（初值「電商/客服回不完」），不動就送出會汙染名單資料。
11. [ ] 手機導覽列「登入」`display:none`（_landing.scss:339）且不在漢堡選單內 → 手機上完全找不到登入 — UX。
12. [x] ✅ sticky nav 68px 遮住錨點標題 — UI　（2026-07-16 完成）：`.lp` 各錨點區加 `scroll-margin-top: 80px`。

### login.vue
13. [ ] **品牌斷層** — UI：Landing 是綠色「MYFEEL」，登入頁卻是黑底 💬 emoji「LINE Bot 管理系統」；產品名全站不一致 → 統一品牌標識與命名。
14. [ ] 錯誤直接顯示 Firebase 英文技術訊息（`auth/popup-closed-by-user`）— UX：使用者只是關彈窗也看到嚇人紅字 → 在地化並忽略「取消」類。

### billing / org 帳務
15. [ ] 付款狀態、藍新導回結果（成功🎉/失敗）灰階下同色 — UI：**最需要顏色的地方失去顏色**（根因 R1，但此頁風險最高，單獨列）。
16. [ ] billing 初次載入無骨架 — UX：`planView` 為 null 時直接顯示「尚未開通付費方案」，付費客戶開頁瞬間看到會誤解、甚至誤觸重新結帳 → 加 loading 骨架。
17. [ ] `AdminInvoiceProfileForm` 幾乎無格式驗證 — UX：統編 8 碼/捐贈碼/手機條碼/Email 無檢查，錯格式付款後才被 ezPay 退件才發現。

### settings（members / organization）
18. [ ] 角色下拉 `@change` 即改權限、無確認無 undo — UX：降權一按生效；而破壞性較低的「移除」反而有 confirm。
19. [ ] webhook 測試結果、角色標籤灰階下成敗/角色看不出差異 — UI（根因 R1）；標題塞長段說明文字牆淹沒關鍵輸入；成員表無 `empty-text`。

### org/[orgId]
20. [x] ✅ org 分頁狀態未進 URL — UX　（2026-07-17 完成）：`tab` 由 `?tab=` 初始化並 `watch` 寫回（`router.replace`），重整/分享連結不再掉回總覽。

### AI 客服
21. [ ] knowledge/sources **「新增單張手寫卡」無入口按鈕** — UX：`openCreateManual` 只在 deep-link 時被呼叫，想手動加一條 Q&A 只能繞道匯入 → 補按鈕。
22. [ ] 「全部重新索引」重量級操作藏在無文字 `🔁` emoji 鈕、且與「🔄 重新同步」極易混淆 — UX：給文字標籤、換區別度高的 icon。
23. [ ] ai-scripts 刪除用原生 confirm；`useUnsavedChanges` 沒帶 `enableBeforeUnload`（:430）— UX：編很久按 F5 全丟無提醒。
24. [ ] playground 五態區塊、ai-usage KPI 卡、ai-scripts 六種節點徽章灰階下只靠 emoji 撐 — UI（根因 R1）。

### flow / richmenu（兩大編輯器）
25. [ ] **完全沒有 LINE 訊息所見即所得預覽** — UX：9 種訊息只是表單欄位（除圖文 hero 畫布），新手看不到氣泡長相 → 加 LINE 樣式即時預覽。
26. [ ] 驗證只在存檔時跑、不指明「第幾則/第幾欄」、不捲動定位、無 inline 紅框 — UX；自訂區塊 `actionError` 是**死碼永不顯示**（`AdminAreaActionEditor` 沒 render `errorMessage`）。
27. [ ] 輪播卡固定 380px 造成「垂直捲動裡再包水平捲動」雙軸捲動、窄螢幕被裁 — UI（_flow.scss:223）。
28. [ ] richmenu 建立即刻部署到 LINE、無草稿/確認步驟 — UX；超界靠存檔自動修正並要求再送一次（逼按兩次，:619）。

### super-admin
29. [x] ✅ `/admin/super` 首頁**空白頁** — UI/UX　（2026-07-16 完成）：加了重導向 middleware 直接送到 `/admin/super/organizations`（未來若要做總覽 dashboard 再改回）。

### liff/lead.vue（LINE webview 內給消費者看）
30. [ ] **出錯把含網址/內部欄位的原始 JSON 倒給消費者看** — UX：還寫「請截圖給工程」；錯誤指示（「回後台重新儲存」）對錯對象（消費者無後台權限）、且無重試按鈕卡死 → 診斷區改 `?debug=1` 才顯示，給消費者可執行出口。

### 其他
31. [x] ✅ conversation-stats「匯出 CSV」無資料時靜默 — UX　（2026-07-16 完成）：按鈕加 `:disabled="!trend.buckets.length"`。
32. [ ] users「從 LINE 同步好友」跑 25 輪無進度顯示 — UX：大量好友時像卡死 → 加進度。
33. [x] ✅ broadcasts 側欄 **failed/cancelled/processing 全同一種灰** — UI　（2026-07-16 完成）：改用 `broadcastTone()`，failed→error、processing→warning、completed/scheduled→success、其餘 neutral。

---

## 🟡 第 3 順位 — 打磨（死碼清理／微調／無障礙）

34. [ ] **殘留死碼清理**（部分完成，稽核有高估）— UI：
    - [x] ✅ `_campaigns.scss` 的 `.cmp-stat-rate`（未用且帶錯誤綠 fallback）已移除。
    - [ ] `_auto-reply.scss`：**不是整批死碼**。`.ar-section-hint`/`.ar-status-switch`/`.ar-any-text-note`/`.ar-section-card` 其實**跨頁共用**（campaigns/organization/support-presets/flow）；只有舊版 layout 類（`.ar-layout`/`.ar-sidebar*`/`.ar-list*`/`.ar-editor(-inner/header/title)`/`.module-picker`/`.module-option*`/`.input-base`）疑似死碼，且與共用類交錯，需**逐類確認**後再動，暫緩。
    - [—] organization「清除憑證」區塊（`showClearStoredCredentials=false`）是**刻意的功能開關**（註解：「改為 true 即可顯示」），**非死碼**，保留。
    - [ ] `areaColors` 色盤在 richmenu 與 FlowRichMessageAreas 重複兩份 → 抽共用常數（待處理）。
35. [ ] **emoji 當功能圖示** — UI：側欄/super/workspaces 大量 emoji 導覽圖示跨平台造型不一（🛡️🗂️ 尤甚），削弱單色設計語言 → 關鍵導覽改單色 SVG，emoji 僅留行銷區。
36. [ ] **樣式散落 `<style scoped>`** — UI：AiContextBanner 大量 px 值寫在元件內，違反本專案「樣式放 partials + token」慣例 → 搬到 partial。
37. [ ] **重複元件抽共用** — UI：統計卡三套（el-card / .bc-stat-box / .cmp-stat-box）、表格兩套（el-table vs 手刻 table）→ 抽 stat-box、統一表格。
38. [ ] **無障礙**（部分完成）— UI：
    - [x] ✅ 漢堡鈕補 `:aria-expanded="menuOpen"`（index.vue）。
    - [x] ✅ 額度 `over` 由 `role="status"` 改為動態 `role="alert"`（AdminQuotaBanner）。
    - [ ] LIFF 按鈕 <44px 觸控目標、done/error 容器缺 `aria-live` 尚未處理。
39. [ ] **對話框固定像素寬** — UI：super（480/440/520px）、邀請（400px）小螢幕頂滿 → 改 `min(Npx, 92vw)`。
40. [ ] **flow 編輯器打磨** — UI/UX：拖曳把手 `⠿` 對比過低、9 顆訊息類型按鈕同權重無主次、`{{...}}` 插入變數鈕語意不明且只附加到字串尾端、用戶輸入卡「必須放最後」只在存檔時驗證、達上限/互斥時按鈕不先 disable。
41. [ ] **匯入對話框** — UI/UX：虛線框暗示可拖放但沒綁 drop 事件、長輪詢（8 分鐘）無取消鈕。
42. [ ] **殘留彩色收斂**（併入根因 R5 一起做）— UI：flow 拖放綠暈＋黑框雙訊號、LayoutPresetPicker 藍縮圖框、對話頁 active 藍、stats handoff 紫。

---

## ✅ 已做得好（確認現況，值得保留，勿動壞）

- ai-settings 的**基本/進階分層**、模型欄位只給 super admin —— 過去痛點已解。
- knowledge 的切卡/reindex **5 秒輪詢自動刷新**、上傳改 signed URL 繞過 413、預覽改非同步 job 繞過 504、匯入結果列出失敗卡 —— 舊痛點已明顯改善。
- 額度 banner **正確手刻橘/紅語意色**並分 near/over 兩階（全站唯一把顏色做對的地方，可當 R1 的範本）。
- richmenu 畫布「色號＋編號對應」做得好。
