import { describe, it, expect } from 'vitest'
import { wordCloudItems, weekHourHeatmap, monthlyTrend, donutSegments, moodDualLinePoints, moodRiverBands } from '../insights'
import type { Friend, EmotionDist, FriendEmotion } from '@nianlun/core'

const mkFriend = (monthly: number[]): Friend => ({ monthly } as unknown as Friend)

describe('wordCloudItems', () => {
  it('空数组返回空', () => {
    expect(wordCloudItems([])).toEqual([])
  })

  it('词数少于上限时全部返回，且保留 word/count', () => {
    const out = wordCloudItems([{ word: '基金', count: 10 }, { word: '行情', count: 4 }])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ word: '基金', count: 10 })
  })

  it('截断到 maxItems', () => {
    const kws = Array.from({ length: 40 }, (_, i) => ({ word: `w${i}`, count: 40 - i }))
    expect(wordCloudItems(kws, 30)).toHaveLength(30)
  })

  it('全部同频时给中间档 tier=3', () => {
    const out = wordCloudItems([{ word: 'a', count: 5 }, { word: 'b', count: 5 }])
    expect(out.every((x) => x.tier === 3)).toBe(true)
  })

  it('最高频 tier=5、最低频 tier=1，tier 落在 1–5', () => {
    const out = wordCloudItems([
      { word: 'hi', count: 100 },
      { word: 'mid', count: 50 },
      { word: 'lo', count: 1 },
    ])
    expect(out[0].tier).toBe(5)
    expect(out[2].tier).toBe(1)
    expect(out.every((x) => x.tier >= 1 && x.tier <= 5)).toBe(true)
  })
})

describe('weekHourHeatmap', () => {
  it('全 0 时 peak 为 null、max 为 0、7 行每行 24 格', () => {
    const r = weekHourHeatmap(new Array(168).fill(0))
    expect(r.max).toBe(0)
    expect(r.peak).toBeNull()
    expect(r.rows).toHaveLength(7)
    expect(r.rows.every((row) => row.cells.length === 24)).toBe(true)
  })

  it('按周一→周日重排（首行「一」末行「日」）', () => {
    const r = weekHourHeatmap(new Array(168).fill(0))
    expect(r.rows[0].label).toBe('一')
    expect(r.rows[6].label).toBe('日')
  })

  it('正确定位峰值（周一 20 点）并把该天数据放到首行', () => {
    const wh = new Array(168).fill(0)
    wh[1 * 24 + 20] = 5 // 周一(getDay=1) 20:00
    wh[0 * 24 + 9] = 3 // 周日(getDay=0) 9:00
    const r = weekHourHeatmap(wh)
    expect(r.max).toBe(5)
    expect(r.peak).toEqual({ label: '一', hour: 20, count: 5 })
    // 首行是周一，第 20 格应为 5
    expect(r.rows[0].label).toBe('一')
    expect(r.rows[0].cells[20]).toBe(5)
    // 末行是周日，第 9 格应为 3
    expect(r.rows[6].cells[9]).toBe(3)
  })
})

describe('monthlyTrend', () => {
  it('无好友时 12 个月全 0、max/total 为 0、peak 为 null', () => {
    const r = monthlyTrend([])
    expect(r.months).toHaveLength(12)
    expect(r.months[0]).toMatchObject({ label: '1月', count: 0 })
    expect(r.max).toBe(0)
    expect(r.total).toBe(0)
    expect(r.peak).toBeNull()
  })

  it('跨好友按月累加，算出 pct/total/peak', () => {
    const a = mkFriend([10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5]) // 1月10, 12月5
    const b = mkFriend([0, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]) // 3月20
    const r = monthlyTrend([a, b])
    expect(r.months[0].count).toBe(10) // 1月
    expect(r.months[2].count).toBe(20) // 3月
    expect(r.months[11].count).toBe(5) // 12月
    expect(r.total).toBe(35)
    expect(r.max).toBe(20)
    expect(r.months[2].pct).toBe(100) // 3月是峰值
    expect(r.months[0].pct).toBe(50) // 10/20
    expect(r.peak).toEqual({ label: '3月', count: 20 })
  })
})

describe('donutSegments', () => {
  it('total=0 返回空', () => {
    expect(donutSegments({ happy: 0, neutral: 0, sad: 0, total: 0, avg: 0.5 })).toEqual([])
  })
  it('三段 frac 之和为 1、角度覆盖 2π、含三种颜色', () => {
    const d: EmotionDist = { happy: 2, neutral: 1, sad: 1, total: 4, avg: 0.6 }
    const segs = donutSegments(d)
    expect(segs).toHaveLength(3)
    expect(segs.reduce((s, x) => s + x.frac, 0)).toBeCloseTo(1)
    expect(segs[segs.length - 1].end - segs[0].start).toBeCloseTo(Math.PI * 2)
    expect(new Set(segs.map((s) => s.color)).size).toBe(3)
  })
  it('占比为 0 的档也保留但 frac=0', () => {
    const segs = donutSegments({ happy: 4, neutral: 0, sad: 0, total: 4, avg: 1 })
    expect(segs.find((s) => s.label === '难过')!.frac).toBe(0)
  })
})

describe('moodDualLinePoints', () => {
  const mk = (me: (number | null)[]): FriendEmotion['monthly'] => ({
    me: me.map((v) => (v === null ? null : { avg: v, count: 1 })),
    them: Array(12).fill(null),
  })
  const opts = { width: 300, height: 150, pad: 20 }

  it('全 null → hasData false、无点', () => {
    const r = moodDualLinePoints(mk(Array(12).fill(null)), opts)
    expect(r.hasData).toBe(false)
    expect(r.me).toHaveLength(0)
  })
  it('部分月有值 → 只产非 null 月的点，带月份 m', () => {
    const arr = Array(12).fill(null); arr[0] = 1; arr[5] = 0
    const r = moodDualLinePoints(mk(arr), opts)
    expect(r.hasData).toBe(true)
    expect(r.me.map((p) => p.m)).toEqual([0, 5])
    // avg=1 → 顶部(y 最小)，avg=0 → 底部(y 最大)
    expect(r.me[0].y).toBeLessThan(r.me[1].y)
    // x 随月份递增
    expect(r.me[0].x).toBeLessThan(r.me[1].x)
  })
  it('avg=0.5 → y 居中', () => {
    const arr = Array(12).fill(null); arr[6] = 0.5
    const r = moodDualLinePoints(mk(arr), opts)
    expect(r.me[0].y).toBeCloseTo(opts.height / 2)
  })
})

describe('moodRiverBands', () => {
  // 每项 [avg, count] 或 null
  const side = (vals: ([number, number] | null)[]) =>
    vals.map((v) => (v === null ? null : { avg: v[0], count: v[1] }))
  const mk = (
    me: ([number, number] | null)[],
    them: ([number, number] | null)[] = Array(12).fill(null),
  ): FriendEmotion['monthly'] => ({ me: side(me), them: side(them) })
  const opts = { width: 300, height: 150, pad: 20 }
  const maxHalf = (opts.height - 2 * opts.pad) * 0.16

  it('全空 → hasData false、两侧无段、midY 居中', () => {
    const r = moodRiverBands(mk(Array(12).fill(null)), opts)
    expect(r.hasData).toBe(false)
    expect(r.me.segments).toHaveLength(0)
    expect(r.them.segments).toHaveLength(0)
    expect(r.midY).toBeCloseTo(opts.height / 2)
  })

  it('连续月 → 单段；null 断流 → 切成两段', () => {
    const arr: ([number, number] | null)[] = Array(12).fill(null)
    arr[0] = [1, 5]; arr[1] = [0.8, 5]        // 连续两月
    arr[5] = [0.2, 5]                          // 断开后的孤立月由下条覆盖
    arr[8] = [0.5, 5]; arr[9] = [0.6, 5]       // 又一段连续两月
    const r = moodRiverBands(mk(arr), opts)
    expect(r.hasData).toBe(true)
    // 段：[0,1] / [5] / [8,9] → 3 段
    expect(r.me.segments.map((s) => s.points.map((p) => p.m)))
      .toEqual([[0, 1], [5], [8, 9]])
  })

  it('孤立单月 → 段内仅 1 点', () => {
    const arr: ([number, number] | null)[] = Array(12).fill(null)
    arr[6] = [0.5, 3]
    const r = moodRiverBands(mk(arr), opts)
    expect(r.me.segments).toHaveLength(1)
    expect(r.me.segments[0].points).toHaveLength(1)
  })

  it('centerY：avg=1 顶部(y 最小)、avg=0 底部(y 最大)、avg=0.5 居中；x 随月递增', () => {
    const arr: ([number, number] | null)[] = Array(12).fill(null)
    arr[0] = [1, 1]; arr[1] = [0, 1]
    const r = moodRiverBands(mk(arr), opts)
    const [p0, p1] = r.me.segments[0].points
    expect(p0.centerY).toBeLessThan(p1.centerY)
    expect(p0.x).toBeLessThan(p1.x)
    const mid = moodRiverBands(mk([[0.5, 1], ...Array(11).fill(null)] as any), opts)
    expect(mid.me.segments[0].points[0].centerY).toBeCloseTo(opts.height / 2)
  })

  it('带宽归一化：最大 count 月 halfW≈maxHalf，最小非零 count 月≥minHalf，且都在 [2, maxHalf]', () => {
    const arr: ([number, number] | null)[] = Array(12).fill(null)
    arr[0] = [0.5, 1]; arr[1] = [0.5, 100]     // 相邻，同段，count 1 vs 100
    const r = moodRiverBands(mk(arr), opts)
    const [small, big] = r.me.segments[0].points
    expect(big.halfW).toBeCloseTo(maxHalf)
    expect(small.halfW).toBeGreaterThanOrEqual(2)
    for (const p of [small, big]) {
      expect(p.halfW).toBeGreaterThanOrEqual(2)
      expect(p.halfW).toBeLessThanOrEqual(maxHalf + 1e-9)
    }
  })

  it('单侧空 → 空侧 segments 为 []，另一侧正常', () => {
    const r = moodRiverBands(mk([[0.5, 3], ...Array(11).fill(null)] as any), opts)
    expect(r.them.segments).toEqual([])
    expect(r.me.segments).toHaveLength(1)
  })

  it('峰谷：可信月里取 avg 最高/最低月（0-based 索引）', () => {
    const arr: ([number, number] | null)[] = Array(12).fill(null)
    arr[1] = [0.9, 10]; arr[3] = [0.2, 10]; arr[7] = [0.5, 10]  // 皆可信(count=10)
    const r = moodRiverBands(mk(arr), opts)
    expect(r.me.warmest).toBe(1)
    expect(r.me.coldest).toBe(3)
  })

  it('峰谷：噪声月(count 低于阈值)不参与评选', () => {
    const arr: ([number, number] | null)[] = Array(12).fill(null)
    arr[2] = [0.99, 1]   // avg 最高但 count=1，maxCount=20 → 阈值 max(3,4)=4，被排除
    arr[5] = [0.7, 20]   // 可信
    arr[9] = [0.3, 20]   // 可信
    const r = moodRiverBands(mk(arr), opts)
    expect(r.me.warmest).toBe(5)   // 不是噪声的 2
    expect(r.me.coldest).toBe(9)
  })

  it('峰谷：无可信月 → null', () => {
    const arr: ([number, number] | null)[] = Array(12).fill(null)
    arr[0] = [0.8, 1]; arr[1] = [0.2, 2]   // maxCount=2 → 阈值 max(3,0.4)=3，全不达标
    const r = moodRiverBands(mk(arr), opts)
    expect(r.me.warmest).toBeNull()
    expect(r.me.coldest).toBeNull()
  })

  it('峰谷：avg 并列取更早月份', () => {
    const arr: ([number, number] | null)[] = Array(12).fill(null)
    arr[4] = [0.6, 10]; arr[8] = [0.6, 10]
    const r = moodRiverBands(mk(arr), opts)
    expect(r.me.warmest).toBe(4)
    expect(r.me.coldest).toBe(4)
  })
})
