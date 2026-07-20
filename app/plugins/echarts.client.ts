// ECharts：只在瀏覽器端註冊（canvas 需要 DOM），並且 tree-shake 只引入用到的模組，
// 避免把整包 ECharts 打進 bundle。頁面用 <ClientOnly><VChart …/></ClientOnly> 呼叫。
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, BarChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkPointComponent,
} from 'echarts/components'
import VChart from 'vue-echarts'

export default defineNuxtPlugin((nuxtApp) => {
  use([
    CanvasRenderer,
    LineChart,
    BarChart,
    GridComponent,
    TooltipComponent,
    LegendComponent,
    DataZoomComponent,
    MarkPointComponent,
  ])
  nuxtApp.vueApp.component('VChart', VChart)
})
