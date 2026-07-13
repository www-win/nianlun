# 情绪河流（Mood River）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把好友详情页「情绪波动」模块的简单双折线，升级为共享情绪轴的双向面积「情绪河流」——垂直位置=月度情绪 avg、河带宽度=当月消息量 count，暖橙=我 / 冷蓝=TA。

**Architecture:** 纯几何计算落在 `packages/miniapp/src/lib/insights.ts` 新增的 `moodRiverBands`（无副作用、可单测，把逐月 `avg/count` 换算成河带多边形顶点 + 峰谷月）；canvas 绘制落在 `friend-detail.vue` 的 `drawMood()`（填充平滑河带 + 三区背景 + 轴标注）。core 不动，只用已存的 `avg + count`，老数据直接生效。

**Tech Stack:** TypeScript、Vue 3（uni-app）、uni canvas API（`createCanvasContext` / `quadraticCurveTo` / `setFillStyle` / `createSelectorQuery`）、Vitest。

## Global Constraints

- `@nianlun/core` 不得修改；纯几何只能用已存字段 `MonthMood { avg, count }`，不新增 core 字段、不需重新导入。
- 纯逻辑放 `insights.ts`（不碰 canvas/DOM/uni），绘制放 `.vue`；单向依赖：绘制层 → 纯几何层。
- 画布真实宽度沿用现有 `uni.createSelectorQuery().select('.mood-canvas').boundingClientRect` 量取，绘制坐标系与画布严格一致。
- 颜色固定：我填充 `rgba(232,160,75,0.5)`、描边 `#e8a04b`；TA 填充 `rgba(90,143,208,0.45)`、描边 `#5a8fd0`；中性基线 `#e5e7eb`。
- 归一化参数：`minHalf = 2`（px），`maxHalf = (height - 2*pad) * 0.16`；可信月阈值 `count >= max(3, maxCount * 0.2)`。
- 几何公式沿用现有：`x(m) = pad + (m/11)*(width-2*pad)`；`centerY(avg) = height - pad - avg*(height-2*pad)`。
- 不引入任何新依赖。测试命令：`pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/insights.test.ts`。

---

## File Structure

- `packages/miniapp/src/lib/insights.ts` — 新增 `moodRiverBands` 及其类型（`RiverPt` / `RiverSegment` / `RiverSide` / `MoodRiver`）。旧 `moodDualLinePoints` 先保留，Task 6 清理。
- `packages/miniapp/src/lib/__tests__/insights.test.ts` — 新增 `describe('moodRiverBands')`；Task 6 移除 `describe('moodDualLinePoints')`。
- `packages/miniapp/src/pages/friend-detail/friend-detail.vue` — 改写 `drawMood()`、`hasMood`；新增 `moodCaption` 计算与模板 caption/图例提示。

---

## Task 1: `moodRiverBands` 骨架（分段 / 顶点 / 带宽归一化 / midY / hasData）

**Files:**
- Modify: `packages/miniapp/src/lib/insights.ts`（在 `moodDualLinePoints` 之后追加）
- Test: `packages/miniapp/src/lib/__tests__/insights.test.ts`

**Interfaces:**
- Consumes: `FriendEmotion['monthly']`（`{ me: (MonthMood|null)[]; them: (MonthMood|null)[] }`，长度 12；`MonthMood = { avg: number; count: number }`），来自 `@nianlun/core`。
- Produces:
  ```ts
  export interface RiverPt { x: number; centerY: number; halfW: number; m: number }
  export interface RiverSegment { points: RiverPt[] }
  export interface RiverSide { segments: RiverSegment[]; warmest: number | null; coldest: number | null }
  export interface MoodRiver { me: RiverSide; them: RiverSide; hasData: boolean; midY: number }
  export function moodRiverBands(
    monthly: FriendEmotion['monthly'],
    opts: { width: number; height: number; pad: number },
  ): MoodRiver
  ```
  （本任务只填充 `segments` / `midY` / `hasData`；`warmest` / `coldest` 本任务先恒为 `null`，Task 2 补真值。）

- [ ] **Step 1: 写失败测试**

在 `insights.test.ts` 末尾追加：

```ts
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
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/insights.test.ts -t moodRiverBands`
Expected: FAIL —— `moodRiverBands is not exported` / `is not a function`。

- [ ] **Step 3: 写最小实现**

在 `insights.ts` 中 `moodDualLinePoints` 之后追加（`FriendEmotion` 已在文件顶部 import）：

```ts
export interface RiverPt { x: number; centerY: number; halfW: number; m: number }
export interface RiverSegment { points: RiverPt[] }
export interface RiverSide { segments: RiverSegment[]; warmest: number | null; coldest: number | null }
export interface MoodRiver { me: RiverSide; them: RiverSide; hasData: boolean; midY: number }

/**
 * 逐月情绪(avg 0..1) + 消息量(count) → 「情绪河流」双向面积几何。
 * 中心线 y=情绪高低（上开心/下难过），河带半宽 halfW=当月消息量（归一化）。
 * null 月断流：只在相邻连续月成段。warmest/coldest 见 pickPeak（Task 2）。
 */
export function moodRiverBands(
  monthly: FriendEmotion['monthly'],
  opts: { width: number; height: number; pad: number },
): MoodRiver {
  const { width, height, pad } = opts
  const plotH = height - 2 * pad
  const minHalf = 2
  const maxHalf = plotH * 0.16
  const centerY = (avg: number) => height - pad - avg * plotH
  const x = (m: number) => pad + (m / 11) * (width - 2 * pad)

  // 两侧共用的最大 count（全 0 / 无月 → 1，避免除零）
  let maxCount = 0
  for (const arr of [monthly.me, monthly.them]) {
    for (const mm of arr) if (mm && mm.count > maxCount) maxCount = mm.count
  }
  if (maxCount === 0) maxCount = 1
  const halfW = (count: number) => minHalf + (count / maxCount) * (maxHalf - minHalf)

  const buildSide = (arr: (typeof monthly.me)): RiverSide => {
    const segments: RiverSegment[] = []
    let cur: RiverPt[] = []
    arr.forEach((mm, m) => {
      if (!mm) { if (cur.length) { segments.push({ points: cur }); cur = [] }; return }
      cur.push({ x: x(m), centerY: centerY(mm.avg), halfW: halfW(mm.count), m })
    })
    if (cur.length) segments.push({ points: cur })
    return { segments, warmest: null, coldest: null }
  }

  const me = buildSide(monthly.me)
  const them = buildSide(monthly.them)
  const hasData = me.segments.length > 0 || them.segments.length > 0
  return { me, them, hasData, midY: centerY(0.5) }
}
```

同时在测试文件顶部 import 补上新符号（第 2 行）：

```ts
import { wordCloudItems, weekHourHeatmap, monthlyTrend, donutSegments, moodDualLinePoints, moodRiverBands } from '../insights'
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/insights.test.ts -t moodRiverBands`
Expected: PASS（6 个用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/lib/insights.ts packages/miniapp/src/lib/__tests__/insights.test.ts
git commit -m "feat(miniapp): moodRiverBands 情绪河流几何（分段/带宽归一化）"
```

---

## Task 2: `moodRiverBands` 峰谷月（warmest / coldest + 可信月阈值）

**Files:**
- Modify: `packages/miniapp/src/lib/insights.ts:moodRiverBands`
- Test: `packages/miniapp/src/lib/__tests__/insights.test.ts:describe('moodRiverBands')`

**Interfaces:**
- Consumes: Task 1 的 `RiverSide` / `MoodRiver`，以及内部已算出的 `maxCount`。
- Produces: `RiverSide.warmest` / `RiverSide.coldest` 填真值——各侧在「可信月」(`count >= max(3, maxCount*0.2)`) 中取 `avg` 最高月为 `warmest`、最低月为 `coldest`（月索引 0..11）；无可信月 → `null`；`avg` 并列取月份更早者。

- [ ] **Step 1: 追加失败测试**

在 `describe('moodRiverBands')` 内追加：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/insights.test.ts -t moodRiverBands`
Expected: FAIL —— warmest/coldest 仍为 `null`，前两个新用例断言不满足。

- [ ] **Step 3: 实现峰谷筛选**

在 `moodRiverBands` 内新增 helper，并在 `buildSide` 里调用（替换掉 Task 1 里恒 `null` 的两行）：

```ts
  const threshold = Math.max(3, maxCount * 0.2)
  const pickPeak = (arr: (typeof monthly.me)): { warmest: number | null; coldest: number | null } => {
    let warmest: number | null = null, coldest: number | null = null
    let hi = -Infinity, lo = Infinity
    arr.forEach((mm, m) => {
      if (!mm || mm.count < threshold) return
      if (mm.avg > hi) { hi = mm.avg; warmest = m }   // 严格 > → 并列取更早月
      if (mm.avg < lo) { lo = mm.avg; coldest = m }
    })
    return { warmest, coldest }
  }
```

把 `buildSide` 的返回改为：

```ts
    const { warmest, coldest } = pickPeak(arr)
    return { segments, warmest, coldest }
```

（`buildSide` 需能拿到 `arr`——它本就接收 `arr` 参数，直接传给 `pickPeak(arr)` 即可。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/insights.test.ts -t moodRiverBands`
Expected: PASS（10 个用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/lib/insights.ts packages/miniapp/src/lib/__tests__/insights.test.ts
git commit -m "feat(miniapp): moodRiverBands 峰谷月评选（可信月阈值）"
```

---

## Task 3: 改写 `drawMood()` 渲染情绪河流 + `hasMood` 切换

**Files:**
- Modify: `packages/miniapp/src/pages/friend-detail/friend-detail.vue`（`<script>` 内 `drawMood` 函数、`hasMood` 计算、import）

**Interfaces:**
- Consumes: `moodRiverBands`（Task 1/2）、`emotion.value.monthly`。
- Produces: canvas `moodLine` 上渲染出情绪河流（本任务无单测，靠 Step 4 目测验收）。

- [ ] **Step 1: 引入 `moodRiverBands`，切换 `hasMood`**

修改 `friend-detail.vue` 第 12 行 import（把 `moodDualLinePoints` 换成 `moodRiverBands`）：

```ts
import { wordCloudItems, weekHourHeatmap, monthlyTrend, donutSegments, moodRiverBands } from '../../lib/insights'
```

把 `hasMood` 计算（约 29-30 行）改为：

```ts
const hasMood = computed(() => !!emotion.value && moodRiverBands(
  emotion.value.monthly, { width: 300, height: 150, pad: 20 }).hasData)
```

- [ ] **Step 2: 改写 `drawMood()`**

把现有 `drawMood()`（约 57-85 行）整体替换为：

```ts
function drawMood() {
  const emo = emotion.value
  if (!emo) return
  uni.createSelectorQuery().select('.mood-canvas').boundingClientRect((res) => {
    const rect = res as UniApp.NodeInfo
    const W = rect && rect.width ? rect.width : moodPx
    const H = rect && rect.height ? rect.height : moodPx
    const pad = 20
    const river = moodRiverBands(emo.monthly, { width: W, height: H, pad })
    const ctx = uni.createCanvasContext('moodLine')

    // 背景三区：上暖(开心)下冷(难过)极淡 wash，中间留中性带
    const band = (H - 2 * pad) * 0.1
    ctx.setFillStyle('rgba(232,160,75,0.05)')
    ctx.fillRect(pad, pad, W - 2 * pad, river.midY - band - pad)
    ctx.setFillStyle('rgba(90,143,208,0.05)')
    ctx.fillRect(pad, river.midY + band, W - 2 * pad, H - pad - (river.midY + band))
    // 中性基线
    ctx.beginPath(); ctx.setStrokeStyle('#e5e7eb'); ctx.setLineWidth(1)
    ctx.moveTo(pad, river.midY); ctx.lineTo(W - pad, river.midY); ctx.stroke()

    // 左侧情绪三档 + 底部月份刻度
    ctx.setFillStyle('#9aa0aa'); ctx.setFontSize(10)
    ctx.setTextAlign('left'); ctx.setTextBaseline('middle')
    ctx.fillText('开心', 2, pad + 4)
    ctx.fillText('中性', 2, river.midY)
    ctx.fillText('难过', 2, H - pad - 2)
    ctx.setTextAlign('center'); ctx.setTextBaseline('top')
    for (let m = 0; m < 12; m += 2) {
      const mx = pad + (m / 11) * (W - 2 * pad)
      ctx.fillText(String(m + 1), mx, H - 12)
    }

    // 平滑边：从 pts[0] 起，经中点作二次贝塞尔，最后直连尾点
    const smooth = (pts: { x: number; y: number }[]) => {
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2
        const my = (pts[i].y + pts[i + 1].y) / 2
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
      }
      if (pts.length > 1) { const l = pts[pts.length - 1]; ctx.lineTo(l.x, l.y) }
    }

    const drawSide = (side: typeof river.me, fill: string, stroke: string) => {
      for (const seg of side.segments) {
        const pts = seg.points
        if (pts.length === 1) {   // 孤立月 → 水滴
          const p = pts[0]
          ctx.beginPath(); ctx.setFillStyle(fill)
          ctx.arc(p.x, p.centerY, Math.max(p.halfW, 2), 0, Math.PI * 2); ctx.fill()
          continue
        }
        const top = pts.map((p) => ({ x: p.x, y: p.centerY - p.halfW }))
        const bot = pts.map((p) => ({ x: p.x, y: p.centerY + p.halfW })).reverse()
        ctx.beginPath()
        ctx.moveTo(top[0].x, top[0].y); smooth(top)
        ctx.lineTo(bot[0].x, bot[0].y); smooth(bot)
        ctx.closePath(); ctx.setFillStyle(fill); ctx.fill()
        // 中心线
        ctx.beginPath(); ctx.setStrokeStyle(stroke); ctx.setLineWidth(1.5)
        ctx.moveTo(pts[0].x, pts[0].centerY)
        smooth(pts.map((p) => ({ x: p.x, y: p.centerY })))
        ctx.stroke()
      }
    }

    drawSide(river.them, 'rgba(90,143,208,0.45)', '#5a8fd0')  // TA 冷
    drawSide(river.me, 'rgba(232,160,75,0.5)', '#e8a04b')     // 我 暖（叠在上）
    ctx.draw()
  }).exec()
}
```

- [ ] **Step 3: 类型检查通过**

Run: `pnpm --filter @nianlun/miniapp exec vue-tsc --noEmit`
Expected: 无与 `friend-detail.vue` 相关的类型错误（`moodDualLinePoints` 已不再被本文件引用；若报「未使用」以外错误需修）。

- [ ] **Step 4: 真机/开发者工具目测**

启动开发（`start_skill` 或既有 dev 流程），打开一个有情绪数据的好友详情页，确认：河流按月起伏、宽窄随消息量变化、暖/冷两河交叠处叠色、断月不连、孤立月出水滴、左侧三档与底部月份刻度就位。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/pages/friend-detail/friend-detail.vue
git commit -m "feat(miniapp): 情绪波动改渲染情绪河流（双向面积+三区背景+轴刻度）"
```

---

## Task 4: 峰谷 caption + 图例宽度提示（模板）

**Files:**
- Modify: `packages/miniapp/src/pages/friend-detail/friend-detail.vue`（`<script>` 新增 `moodCaption`；`<template>` 情绪波动块；`<style>` 补 `.mood-cap`）

**Interfaces:**
- Consumes: `moodRiverBands(...).me/them` 的 `warmest`/`coldest`（月索引 0..11，与像素尺寸无关，可用固定尺寸算）。
- Produces: canvas 下方一行淡色 caption 文本；图例补「宽度=消息量」。

- [ ] **Step 1: 新增 `moodCaption` 计算**

在 `friend-detail.vue` `<script>` 内（`hasMood` 附近）追加，并把 `RiverSide` 加进 import 类型：

```ts
import { wordCloudItems, weekHourHeatmap, monthlyTrend, donutSegments, moodRiverBands } from '../../lib/insights'
import type { RiverSide } from '../../lib/insights'
```

```ts
const moodCaption = computed(() => {
  const emo = emotion.value
  if (!emo) return ''
  const r = moodRiverBands(emo.monthly, { width: 300, height: 150, pad: 20 })
  const cap = (label: string, s: RiverSide): string => {
    if (s.warmest === null && s.coldest === null) return ''
    const parts: string[] = []
    if (s.warmest !== null) parts.push(`最暖 ${s.warmest + 1}月`)
    if (s.coldest !== null) parts.push(`最冷 ${s.coldest + 1}月`)
    return `${label} ${parts.join(' · ')}`
  }
  return [cap('你', r.me), cap('TA', r.them)].filter(Boolean).join('　|　')
})
```

- [ ] **Step 2: 模板补 caption 与图例提示**

把情绪波动块（约 466-477 行）内 `hasMood` 分支改为：

```html
        <template v-if="hasMood">
          <view class="mood-legend">
            <text class="lg"><text class="dot" style="background:#e8a04b"></text>我</text>
            <text class="lg"><text class="dot" style="background:#5a8fd0"></text>TA</text>
            <text class="lg faint">宽度=消息量</text>
          </view>
          <canvas canvas-id="moodLine" class="mood-canvas" :style="{ height: moodPx + 'px' }"></canvas>
          <text v-if="moodCaption" class="mood-cap faint">{{ moodCaption }}</text>
          <text class="senti-note faint">本地词典估算，仅供参考</text>
        </template>
```

- [ ] **Step 3: 样式补 `.mood-cap`**

在 `<style>` 内 `.mood-canvas` 一行附近追加：

```css
.mood-cap { display: block; margin-top: 12rpx; font-size: 22rpx; text-align: center; }
```

- [ ] **Step 4: 类型检查 + 目测**

Run: `pnpm --filter @nianlun/miniapp exec vue-tsc --noEmit`
Expected: 无类型错误。
目测：canvas 下方出现 `你 最暖 X月 · 最冷 Y月　|　TA 最暖 …` caption；图例出现「宽度=消息量」；某侧无可信月时该侧文案自动省略。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/pages/friend-detail/friend-detail.vue
git commit -m "feat(miniapp): 情绪河流补峰谷 caption 与图例宽度提示"
```

---

## Task 5: 全量测试与回归

**Files:** 无（仅运行）

- [ ] **Step 1: 跑 insights 全套**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/insights.test.ts`
Expected: PASS（含 `moodRiverBands` 10 例 + 原有 `moodDualLinePoints` 例仍全绿）。

- [ ] **Step 2: 跑整包测试**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: 全绿，无回归。

- [ ] **Step 3: 类型检查**

Run: `pnpm --filter @nianlun/miniapp exec vue-tsc --noEmit`
Expected: 无错误。

（本任务无独立提交——若发现问题，回到对应 Task 修复并重跑。）

---

## Task 6: 清理旧 `moodDualLinePoints`（验收通过后）

> 前置：Task 3/4 的情绪河流在真机/开发者工具目测通过，确认不再需要旧折线。

**Files:**
- Modify: `packages/miniapp/src/lib/insights.ts`（删除 `moodDualLinePoints` 及 `MoodPt` / `DualLine` 类型，若无其它引用）
- Modify: `packages/miniapp/src/lib/__tests__/insights.test.ts`（删除 `describe('moodDualLinePoints')` 与 import 中的 `moodDualLinePoints`）

**Interfaces:**
- Consumes: 无。
- Produces: 移除死代码。

- [ ] **Step 1: 确认无残余引用**

Run: `grep -rn "moodDualLinePoints\|MoodPt\|DualLine" packages/miniapp/src`
Expected: 仅剩 `insights.ts` 定义处与测试 `describe` —— 无 `.vue` 引用。若有其它引用则停手，不删。

- [ ] **Step 2: 删除函数、类型与其测试**

从 `insights.ts` 删除 `moodDualLinePoints` 函数及仅其使用的 `MoodPt`/`DualLine` 接口；从 `insights.test.ts` 删除 `describe('moodDualLinePoints', …)` 整块，并把顶部 import 改回：

```ts
import { wordCloudItems, weekHourHeatmap, monthlyTrend, donutSegments, moodRiverBands } from '../insights'
```

- [ ] **Step 3: 跑测试 + 类型检查**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/insights.test.ts && pnpm --filter @nianlun/miniapp exec vue-tsc --noEmit`
Expected: PASS，无类型错误。

- [ ] **Step 4: 提交**

```bash
git add packages/miniapp/src/lib/insights.ts packages/miniapp/src/lib/__tests__/insights.test.ts
git commit -m "refactor(miniapp): 移除被情绪河流取代的 moodDualLinePoints"
```

---

## Self-Review（对照 spec）

- **编码规则**（垂直=情绪 / 带宽=count / 暖橙我 / 冷蓝 TA / 三区背景）→ Task 1（几何）+ Task 3（三区背景、颜色、绘制）。✓
- **架构边界**（纯几何入 insights、绘制入 .vue、core 不动）→ Task 1/2 纯函数、Task 3/4 绘制，无 core 改动。✓
- **数据结构**（`RiverPt/RiverSegment/RiverSide/MoodRiver`）→ Task 1 定义，Task 2/3/4 复用同名同签名。✓
- **几何与归一化**（x/centerY 公式、minHalf/maxHalf、maxCount 除零保护）→ Task 1 实现 + 测试。✓
- **边界情况**（null 断流 / 孤立单月水滴 / 无数据占位 / 单侧空）→ Task 1 测试覆盖断流·单月·单侧空；无数据占位由 `hasMood`（Task 3）驱动现有 `v-else` 文案；孤立月水滴绘制在 Task 3。✓
- **信息增强**（三档标注 / 月份刻度 / 峰谷 caption / 图例宽度提示 / 免责）→ Task 3（标注·刻度）+ Task 4（caption·图例）+ 保留免责。✓
- **可信月阈值** `max(3, maxCount*0.2)` → Task 2 实现 + 测试（噪声月排除 / 无可信月 null）。✓
- **颜色与样式**（精确 rgba）→ Global Constraints + Task 3 verbatim。✓
- **测试清单** → Task 1（正常/断流/单月/全空/单侧空/归一化）+ Task 2（峰谷/噪声/null/并列）覆盖 spec 列举项。✓
- **旧函数先并存后清理** → Task 3 起 .vue 不再引用，Task 6 在目测验收后删除。✓
- **验收标准**（渲染正常 / 四类边界 / 标注齐全 / 测试全绿 / 目测自然）→ Task 3 Step4、Task 5、Task 4 Step4 对应。✓

类型/命名一致性：`moodRiverBands` 签名、`RiverSide.warmest/coldest`、`MoodRiver.midY/hasData` 在 Task 1→4 全程一致；测试 helper `mk/side/opts` 在 Task 1 定义、Task 2 复用同名。✓
