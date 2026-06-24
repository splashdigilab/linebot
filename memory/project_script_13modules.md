---
name: project_script_13modules
description: 拖拉式 AI 客服腳本 13 模塊計畫的範圍、Phase A/B/C 排程與關鍵決策
metadata:
  type: project
---

對標 Raccoon 的「零程式碼 AI 客服腳本」13 模塊計畫。作者(Kevin)選定要做 ①②④⑤⑥⑦⑧⑩⑪⑫⑬（暫緩 ③ 標籤觸發、⑨ API 連接器——⑨ 認定為獨立大工程）。

**核心排程判斷**：清單天然分兩半——「線性相容」(Phase A，純後端/擴充既有節點，可立即出貨) 與「需要 graph pivot」(Phase B，⑥⑦ 是多出口節點，打破現行線性假設)。

- **Phase A（已完成 2026-06-20）**：⑫ handoff AI 摘要、② 意圖觸發(語意範例)、⑤ collect 格式抽取/驗證/重問、⑬ 完成事件統計。詳見 git。
- **Phase B（已完成 2026-06-20）**：引擎圖化——`validateScriptDoc` 改圖驗證(雙向 BFS:可達 + 可達 reply、攔孤兒/死路)、`runNonInteractiveSteps` 通用多出口；⑦ 分支節點(exists/equals/contains 欄位判斷)、⑥ quick-reply 節點(互動式、輸出 LINE Quick Reply、advanceScript 比對 label 走 next)、⑧ 自動完整。節點型別現為 trigger/collect/reply/branch/quickReply。
- **Phase C（已完成 2026-06-20）**：⑩ 貼標節點(ScriptTagNode→addTagsToUser)、⑪ 寫名單節點(ScriptSaveLeadNode→把 collected 映射寫進 user attributes，非 leadClaims)。引入**動作累積器**：runNonInteractiveSteps 走訪時收集 ScriptSideEffect(tag/saveAttributes)，由 async startScript/advanceScript 的 executeScriptActions 執行——這就是 ⑨ 的 tool-call 底座。節點型別:trigger/collect/reply/branch/quickReply/tag/saveLead。
- **未做**：③ 標籤觸發(作者清單未選)、⑨ API 連接器(獨立大工程，底座已備:在 ScriptSideEffect 加 {type:'api'} + 互動式 await 即可)。語意自動貼標(無關鍵字判客訴)亦未做。

**關鍵決策（作者拍板）**：
1. Phase B 前端編輯器走「**節點+下拉接線**」過渡方案(不做完整拖拉畫布)——腳本編輯器是 [app/pages/admin/[workspaceId]/ai-scripts.vue](app/pages/admin/%5BworkspaceId%5D/ai-scripts.vue) 的線性垂直清單，**不是** app/components/flow/(那是另一套 bot_flow/圖文訊息系統)。
2. ② 意圖觸發用「**語意範例向量比對**」而非重用 7 類 MessageIntent(那是答題分流用、非業務情境)。
3. ⑤ collect 用 **regex 格式預設**(電話/Email/數字/自訂)而非 LLM 抽取——零成本零延遲、低學習成本；LLM 模糊抽取留作日後「智慧格式」。

**入口/權限（2026-06-20 開放）**：原本整個 AI 區只給 super admin，且「腳本」頁刻意不給導覽入口（曾被視為無人用）。已開放給**所有內部角色**：default.vue 的 aiNavItems 移除 super-admin gate 並加「🧩 客服腳本」入口；app/middleware/ai-feature.ts 改成只擋未登入(不再 super-admin redirect)。編輯權限仍由各 API 的 requireWorkspaceAccess 把關(腳本建立/改需 admin、列表需 viewer)。同時開放的還有 知識庫/測試對話/用量/AI設定 全部 AI 頁。

**已知 UI 缺口（待做）**：⑪ 寫名單寫進 user attributes，但後台沒有「逐人檢視客人屬性/名單」的頁面(flow.vue 的用戶輸入卡片同樣寫 attributes 也沒檢視頁)。能用 {{屬性名}} 取回，但無法人工查名單——下一步可做。

每次執行前作者要求：先審視操作是否符合 UX 邏輯、最小學習成本。相關 [[project_ai_ux_backlog]] [[feedback_scss_in_partials]] [[feedback_saas_no_tenant_hardcoding]]
