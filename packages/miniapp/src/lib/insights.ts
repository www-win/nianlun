// 概览页「高频词 + 活跃时段 + 月度趋势」的纯展示映射函数。无副作用、可单测。
import type { Friend, EmotionDist, FriendEmotion } from '@nianlun/core'

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

export interface MonthlyTrend {
  months: Array<{ label: string; count: number; pct: number }>
  max: number
  total: number
  peak: { label: string; count: number } | null
}

/**
 * 把所有好友的 monthly(12) 按月累加 → 月度趋势视图模型。
 * pct = count/max*100（供柱高）；peak = 最活跃月份，全 0 时 null。
 */
export function monthlyTrend(friends: Friend[]): MonthlyTrend {
  const sums = new Array(12).fill(0) as number[]
  for (const f of friends) {
    const m = f.monthly ?? []
    for (let i = 0; i < 12; i++) sums[i] += m[i] ?? 0
  }
  const max = Math.max(...sums, 0)
  const total = sums.reduce((a, b) => a + b, 0)
  const months = sums.map((count, i) => ({
    label: `${i + 1}月`,
    count,
    pct: max === 0 ? 0 : Math.round((count / max) * 100),
  }))
  let peakI = -1
  for (let i = 0; i < 12; i++) if (sums[i] > (peakI === -1 ? 0 : sums[peakI])) peakI = i
  const peak = peakI === -1 ? null : { label: months[peakI].label, count: sums[peakI] }
  return { months, max, total, peak }
}

export interface DonutSeg {
  label: '开心' | '平淡' | '难过'
  value: number
  frac: number
  color: string
  start: number   // 弧度，起点 -π/2
  end: number
}

const EMO_COLOR = { 开心: '#e8a04b', 平淡: '#b8bcc4', 难过: '#5a8fd0' } as const

/** 情绪价值分布 → 三色环形弧段。total=0 返回空。角度从 -π/2 顺时针累加。 */
export function donutSegments(dist: EmotionDist): DonutSeg[] {
  if (dist.total === 0) return []
  const parts: Array<{ label: DonutSeg['label']; value: number }> = [
    { label: '开心', value: dist.happy },
    { label: '平淡', value: dist.neutral },
    { label: '难过', value: dist.sad },
  ]
  let angle = -Math.PI / 2
  return parts.map((p) => {
    const frac = p.value / dist.total
    const start = angle
    const end = angle + frac * Math.PI * 2
    angle = end
    return { label: p.label, value: p.value, frac, color: EMO_COLOR[p.label], start, end }
  })
}

export interface MoodPt { x: number; y: number; m: number }
export interface DualLine { me: MoodPt[]; them: MoodPt[]; hasData: boolean }

/**
 * 逐月情绪(0..1) → 双线坐标。null 月不产点（页面只连相邻月 → 断开处不连线）。
 * y：avg=1 顶部(pad)，avg=0 底部(height-pad)，0.5 居中。
 */
export function moodDualLinePoints(
  monthly: FriendEmotion['monthly'],
  opts: { width: number; height: number; pad: number },
): DualLine {
  const { width, height, pad } = opts
  const toPts = (arr: (FriendEmotion['monthly']['me'][number])[]): MoodPt[] => {
    const pts: MoodPt[] = []
    arr.forEach((mm, m) => {
      if (!mm) return
      const x = pad + (m / 11) * (width - 2 * pad)
      const y = height - pad - mm.avg * (height - 2 * pad)
      pts.push({ x, y, m })
    })
    return pts
  }
  const me = toPts(monthly.me)
  const them = toPts(monthly.them)
  return { me, them, hasData: me.length > 0 || them.length > 0 }
}
