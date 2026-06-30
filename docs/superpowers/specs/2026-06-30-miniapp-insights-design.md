# 小程序「高频词 + 活跃时段热力图」设计文档

- 日期：2026-06-30
- 状态：已通过头脑风暴评审
- 主题：在小程序概览页底部新增「高频词标签云」与「周×小时活跃热力图」两块数据可视化

## 1. 背景与目标

年轮 core 早已为每个好友算好 `hourly`(24)/`weekHour`(168)/`keywords`(Top20)，`buildReport` 也算好全局 `keywords`(Top50)，并导出 `sumHourly`/`sumWeekHour` 汇总函数。网页版已有 `HourBars`/`WeekHourHeatmap`/`WordRanks` 图表组件，但**小程序尚未展示这些数据**。

目标：把「高频词」和「活跃时段热力图」搬进小程序概览页。**纯本地展示**——不联网、不调 AI、不重新解析；数据全部来自已持久化的 `Friend[]` + `ReportData`，打开即算即显。

## 2. 范围

### 做
1. 概览页底部新增「**高频词**」块：标签云（字号/深浅按词频）。
2. 概览页底部新增「**活跃时段**」块：周(行) × 小时(列) 7×24 热力图。

### 不做
24 小时柱状图（用户只要热力图）、单好友维度的图、新 tab、任何 AI/联网。

## 3. 架构与数据

- 复用 core 已导出的 `sumWeekHour(friends): number[]`（168）。`keywords` 直接读 `data.report.keywords`。**core 不改动。**
- 在 miniapp 新增一个纯函数模块 `lib/insights.ts`，做「数据 → 视图模型」的纯映射，**可单测**：
  - `wordCloudItems(keywords, maxItems=30): Array<{ word: string; count: number; tier: number }>`
    - 取前 `maxItems` 个；`tier` 为 1–5 档，按 count 在 [min,max] 区间线性分档（max==min 时全取中档），供页面映射字号/深浅。
  - `weekHourHeatmap(weekHour: number[]): { rows: Array<{ label: string; cells: number[] }>; max: number; peak: { label: string; hour: number; count: number } | null }`
    - 输入 168 数组（索引 = `getDay()*24 + 小时`，getDay 0=周日）。
    - 输出 **7 行，按周一→周日重排**（label 为「一二三四五六日」），每行 24 个 cell。
    - `max` = 全体最大值（供页面算颜色深浅 = count/max）；`peak` = 最活跃格（行 label + 小时 + 次数），全 0 时为 null。

页面只做渲染（读 store → 调上面两个纯函数 → 画），不含逻辑。

## 4. 页面（概览页 `overview.vue` 追加）

在现有「关系分布」块下方追加两块卡片：

- **高频词**：`wordCloudItems(report.keywords)` → flex-wrap 标签流；字号按 `tier`（5 档，如 24→40rpx），颜色用玉色系按 tier 加深。无关键词时整块不显示。
- **活跃时段**：`weekHourHeatmap(sumWeekHour(friends))` → 顶部一行小时刻度（0/6/12/18/23 简标），下面 7 行（周一→周日），每行 24 个小方格，背景色 = 玉色 + 透明度`count/max`。下方一句「最活跃：周X N 点（M 条）」用 `peak`。全 0 时整块不显示。

UI 沿用 `App.vue` 的玉色设计令牌与 `.card` 等共享类。

## 5. 测试

- `lib/insights.ts` 两个纯函数走 vitest（TDD）：
  - `wordCloudItems`：分档边界（全相同 count、空数组、少于 maxItems、tier 落在 1–5）。
  - `weekHourHeatmap`：重排正确（周一在首、周日在末）、max/peak 计算、全 0 返回 peak=null、cells 长度 24/行数 7。
- 概览页渲染靠微信开发者工具真机验证（空数据/有数据两态）。

## 6. 风险

- **词质量**：分词在设备无 `Intl.Segmenter` 时走 bigram 降级，词偏碎（已有能力，不崩）。可接受。
- **热力图密度**：7×24=168 个小格在小屏偏密；用 rpx 自适应 + 合理间距，必要时让小时刻度稀疏标注。
