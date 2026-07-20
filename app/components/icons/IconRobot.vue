<!--
  自製機器人 icon（Element Plus 沒有內建 robot）。
  刻意做成跟 @element-plus/icons-vue 相同慣例：viewBox 0 0 1024 1024、
  fill: currentColor、無固定寬高 → 放進 <el-icon> 會自動吃 font-size 與顏色。
  眼睛/嘴巴用 evenodd 挖空，透出底色（綠底鈕→白臉、灰底頭像→綠臉）。
-->
<template>
  <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">
    <!-- 天線 -->
    <circle cx="512" cy="150" r="44" />
    <rect x="490" y="190" width="44" height="84" rx="16" />
    <!-- 兩側耳朵 -->
    <rect x="166" y="432" width="50" height="150" rx="24" />
    <rect x="808" y="432" width="50" height="150" rx="24" />
    <!-- 頭（含眼睛、嘴巴挖空） -->
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M312 262 H712 A96 96 0 0 1 808 358 V666 A96 96 0 0 1 712 762 H312 A96 96 0 0 1 216 666 V358 A96 96 0 0 1 312 262 Z
         M400 428 A66 66 0 1 0 400 560 A66 66 0 1 0 400 428 Z
         M624 428 A66 66 0 1 0 624 560 A66 66 0 1 0 624 428 Z
         M406 632 H618 A28 28 0 0 1 618 688 H406 A28 28 0 0 1 406 632 Z"
    />
  </svg>
</template>
