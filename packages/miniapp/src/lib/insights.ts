// 概览页「高频词 + 活跃时段」的纯展示映射函数。无副作用、可单测。

export interface WordCloudItem { word: string; count: number; tier: number }

/**
 * 关键词 → 标签云项。取前 maxItems 个，按 count 在 [min,max] 线性分 1–5 档（tier），
 * 供页面映射字号/深浅。全部同频时统一给中间档 3。
 */
export function wordCloudItems(
  keywords: Array<{ word: string; count: number }>,
  maxItems = 30,
): WordCloudItem[] {
  const items = keywords.slice(0, maxItems)
  if (items.length === 0) return []
  const counts = items.map((k) => k.count)
  const min = Math.min(...counts)
  const max = Math.max(...counts)
  return items.map((k) => {
    const tier = max === min ? 3 : 1 + Math.round(((k.count - min) / (max - min)) * 4)
    return { word: k.word, count: k.count, tier }
  })
}

export interface HeatmapRow { label: string; cells: number[] }
export interface Heatmap {
  rows: HeatmapRow[]
  max: number
  peak: { label: string; hour: number; count: number } | null
}

// getDay(): 0=周日, 1=周一 … 6=周六
const DAY_LABEL = ['日', '一', '二', '三', '四', '五', '六']
// 展示顺序：周一→周日
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

/**
 * 168 长 weekHour（索引 = getDay()*24 + 小时）→ 7×24 热力图视图模型。
 * 行按周一→周日重排；max 供页面算颜色深浅；peak 为最活跃格，全 0 时 null。
 */
export function weekHourHeatmap(weekHour: number[]): Heatmap {
  const at = (i: number) => weekHour[i] ?? 0
  const rows: HeatmapRow[] = DISPLAY_ORDER.map((day) => ({
    label: DAY_LABEL[day],
    cells: Array.from({ length: 24 }, (_, h) => at(day * 24 + h)),
  }))

  let max = 0
  let peakIdx = -1
  for (let i = 0; i < 168; i++) {
    if (at(i) > max) { max = at(i); peakIdx = i }
  }
  const peak = max > 0
    ? { label: DAY_LABEL[Math.floor(peakIdx / 24)], hour: peakIdx % 24, count: max }
    : null

  return { rows, max, peak }
}
