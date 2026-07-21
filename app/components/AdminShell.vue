<template>
  <!-- 後台外殼：側欄（可捲區 + 固定 footer）＋ 主內容區。
       default / super-admin 兩個 layout 與組織頁共用同一套骨架，避免各自手抄一份。
       樣式見 assets/scss/layout/_sidebar.scss 與 _main.scss。 -->
  <div class="layout-wrapper">
    <aside class="sidebar" :class="sidebarClass">
      <div class="sidebar-scroll">
        <slot name="sidebar" />
      </div>
      <div v-if="$slots.footer" class="sidebar-footer">
        <slot name="footer" />
      </div>
    </aside>

    <main class="main-content">
      <slot />
    </main>

    <!-- 掛在 wrapper 層、與 sidebar/main 同級的東西（Toast、導覽 agent 等） -->
    <slot name="overlay" />
  </div>
</template>

<script setup lang="ts">
defineProps<{ sidebarClass?: string }>()
</script>
