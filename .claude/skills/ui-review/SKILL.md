---
name: ui-review
description: Review a linebot admin page (Nuxt 4 + Element Plus + ECharts + SCSS partials) for UI/UX quality against this project owner's standards — first-time comprehension, plain non-jargon copy, pixel-level alignment, data correctness before polish, and charts you can read values off. Use when asked to review / 優化 / 檢查 a page's UI/UX, audit a dashboard or stats page, or sweep admin pages for design issues. Optional arg: the page (path or name) to review; add "fix" to also apply the fixes.
---

# UI/UX Review — linebot 後台

Runs the project owner's UI/UX bar over a page and returns a prioritized, actionable findings list (and optionally applies the fixes). The owner's durable preferences live in memory `feedback_uiux_priorities` — this skill operationalizes them. Respond in Traditional Chinese (the owner works in 中文).

## When to use
- "幫我看這頁 UI/UX / 有什麼可以優化" on any admin page.
- Auditing a dashboard / 統計 / 圖表 page.
- Sweeping several admin pages (`app/pages/admin/[workspaceId]/*.vue`) one by one.

## Inputs
- The argument is the target page: a path (`app/pages/admin/[workspaceId]/campaigns.vue`) or a name (`campaigns`, `會員`). If none given, use the file currently open in the IDE; if unclear, ask which page.
- A screenshot, if the user pasted one — use it to catch visual defects code alone won't show (misalignment, clipping, contrast).

## Step 1 — Locate the files
For the target page gather:
- The `.vue` page itself.
- Its SCSS partial: `app/assets/scss/pages/_<name>.scss` (styles live here, **not** in `<style>` — see `feedback_scss_in_partials`).
- Any child components it renders (`app/components/...`) and the API/types it consumes (`server/api/...`, `shared/types/...`) — needed for the data-correctness dimension.

## Step 2 — Review against the 7 dimensions
Score/annotate each. **Order matters — check top-down; a page can't be "good" if it fails an earlier dimension.**

1. **資料正確(最優先)** — Do the numbers tell a TRUE story? Trace suspicious values to source: a metric stuck at 0, a ratio >100%, denominators that don't match numerators, categories that should sum to a total but don't, "empty" states that contradict other numbers. A pretty chart over wrong data is a net negative. If you changed logic anywhere, re-check that copy still matches reality.
2. **第一次看就懂** — Would a non-expert grasp each number in ~2s? Is there a north-star/hero metric, a baseline (vs 上期), and a plain one-line explanation of what the page shows? Are relationships visible (e.g. a breakdown that sums to the total shown as one segmented bar, not N equal cards)?
3. **反術語白話** — Flag internal jargon (首接、場數、已處理、handoff…). Prefer plain wording a layperson gets. BUT: shared enum labels (`INITIAL_HANDLER_LABELS`, `MODULE_TYPE_LABELS`, `STATUS_TABS`…) are used across pages — do **not** de-jargon one page in isolation (breaks consistency). Soften with subtitle/tooltip here; propose a **global rename** as a separate, confirm-first change.
4. **對齊/整齊(像素級)** — The owner notices these instantly: cards in a row equal height; big numbers bottom-aligned across cards; multi-row controls edge-aligned; no dangling dividers at wrap boundaries; chart elements (peak markers, labels) not clipped; consistent spacing/gaps.
5. **圖表能直接讀數** — Charts must have a Y axis with ticks/gridlines, a hover tooltip showing each series' value, and key points (peak) labelled. A single axis-less line or a raw number table fails ("看不出東西"). Use **ECharts (vue-echarts)** — the project's chart stack; register modules in `app/plugins/echarts.client.ts`, render inside `<ClientOnly><VChart :option …/>`.
6. **可操作性** — Are big numbers/segments clickable to drill into the underlying list? Do empty states offer a next action (e.g. 放寬日期) rather than a dead "無資料"? Note count-basis mismatches when linking across views (analytics vs live list) so numbers don't appear to contradict.
7. **色彩語意 + 一致** — Colors carry meaning (good/warning/neutral), not random; a legend where needed; two similar hues (e.g. two greens) disambiguated; theme-aware if the app supports it.

## Step 3 — Report
Return a findings list **ordered by the dimensions above** (correctness first, then clarity, alignment, detail). For each: the issue → why it hurts a first-time viewer → the concrete fix (file + what to change). Keep it scannable. Recommend, don't just survey.

## Step 4 — Apply (only if the user said "fix" / 直接改 / 執行)
- Make the edits. Keep styles in the SCSS partial. Match the surrounding code's idiom.
- **Ask before**: adding a dependency, touching a production hot-path (webhook / message-send / session logic), or changing a metric's semantics. Pure visual/copy tweaks: just do them.
- **Verify** every time: `npx nuxt typecheck` (green), compile the touched SCSS (`npx sass <partial> /tmp/x.css`), `npx vitest run` (no regressions). Run `npx nuxt build` if you added a dependency or a chart. Then remind the user to `npm run dev` for the visual pass — you can't see the rendered page headlessly.

## Notes
- Nuxt auto-imports (`ref`, `computed`, `navigateTo`, `~~/…`) show as "Cannot find name" in inline IDE diagnostics — those are false positives; trust `nuxt typecheck` instead.
- Scale effort to the ask: a quick "看一下" → a few high-value findings; "徹底審" → full 7-dimension sweep + fixes.
