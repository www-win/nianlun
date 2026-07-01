# 好友情绪波动折线 + 双方情绪对比 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在好友详情页，把现有「情绪分析」按钮升级为一次 AI 调用，额外返回逐月情绪走势折线与「我 / TA」双方情绪对比。

**Architecture:** core 新增一个深度情绪 prompt + 容错 parser（纯函数）；miniapp 的 aiClient 改用它，insights 新增折线坐标映射纯函数，friend-detail 页面用 canvas 画折线、用两栏展示双方对比。严格遵守 `miniapp → core` 单向依赖。

**Tech Stack:** TypeScript、Vitest、Vue 3（uni-app mp-weixin）、小程序 canvas（`uni.createCanvasContext`）。

## Global Constraints

- 所有注释/文案用**中文**。
- `@nianlun/core` 是纯函数库：**不碰 DOM/window/网络/vue**；解析器**容错、永不抛异常**（坏数据降级）。
- 依赖链严格 `miniapp → core`，core 不反向依赖。
- 改动 core 后，miniapp 通过 `@nianlun/core` 解析到 **dist**，所以 **miniapp 相关任务前必须先 `pnpm --filter @nianlun/core build`**。
- 情绪分值范围固定 **-100 ~ +100**（0 为中线）；无往来的月 `score` 为 `null`，折线断开、不编造。
- 单次 AI 调用返回全部内容，**不新增调用次数**；结果**不持久化**（与现有 tone/summary 一致）。
- UI 所有 AI 结果块都带「AI 推测，仅供参考」。

---

### Task 1: core — DeepSentiment 类型 + 深度情绪 prompt

**Files:**
- Modify: `packages/core/src/ai/sentiment.ts`（在文件末尾追加类型与函数）
- Modify: `packages/core/src/index.ts:18-19`（追加导出）
- Test: `packages/core/src/ai/__tests__/sentiment.test.ts`（追加 describe）

**Interfaces:**
- Consumes: 现有 `Friend`（含 `monthly: number[]`、`alias`、`name`、`rel`、`role`、`msgCount`、`sentRatio`、`peakPeriod`）、现有 `Sentiment { tone?; summary? }`。
- Produces:
  - `interface MoodTimelinePoint { m: number; score: number | null }`
  - `interface DeepSentiment { tone?: string; summary?: string; timeline?: MoodTimelinePoint[]; me?: Sentiment; them?: Sentiment }`
  - `function buildFriendDeepSentimentPrompt(friend: Friend, samples: string[]): string`

- [ ] **Step 1: 写失败测试**

在 `packages/core/src/ai/__tests__/sentiment.test.ts` 顶部 import 追加 `buildFriendDeepSentimentPrompt`，并在文件末尾追加：

```typescript
describe('buildFriendDeepSentimentPrompt', () => {
  it('含好友名、逐月消息数，并要求输出 timeline 与 me/them', () => {
    const f: Friend = { ...friend, monthly: [3, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 2] }
    const p = buildFriendDeepSentimentPrompt(f, ['我：在吗', '对方：在的~'])
    expect(p).toContain('小美')
    expect(p).toContain('timeline')
    expect(p).toContain('me')
    expect(p).toContain('them')
    expect(p).toContain('score')
    expect(p).toContain('1月:3')   // 逐月消息数已写入
    expect(p).toContain('null')    // 提示无往来月用 null
  })
})
```

（`friend` 与 `import` 行沿用文件顶部已有定义。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/sentiment.test.ts`
Expected: FAIL —— `buildFriendDeepSentimentPrompt is not a function` / 未导出。

- [ ] **Step 3: 实现**

在 `packages/core/src/ai/sentiment.ts` 末尾追加：

```typescript
export interface MoodTimelinePoint { m: number; score: number | null }
export interface DeepSentiment {
  tone?: string
  summary?: string
  timeline?: MoodTimelinePoint[]
  me?: Sentiment
  them?: Sentiment
}

/**
 * 深度情绪提示词：在整体基调之外，额外要求逐月情绪走势(timeline)与「我/对方」各自情绪。
 * 逐月消息数写入 prompt，提示 AI 对无往来月给 null，不要编造。
 */
export function buildFriendDeepSentimentPrompt(friend: Friend, samples: string[]): string {
  const displayName = friend.alias || friend.name
  const sampleBlock = samples.length
    ? samples.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '（本次无可用聊天样本）'
  const monthly = (friend.monthly ?? []).map((c, i) => `${i + 1}月:${c}`).join(' ')

  return [
    '你是一位擅长体察人际情绪的观察者。请根据下面这位微信好友的往来统计与部分聊天样本，',
    '判断你们这一年相处的「情绪基调」，并给出逐月情绪走势，以及双方各自的情绪。',
    '',
    '只输出一个严格的 JSON 对象，不要任何解释、不要代码围栏外的文字。格式：',
    '{',
    '  "tone": "<一个具体、生动的情绪基调短词，如 热络/暧昧/渐远/客套/无话不谈>",',
    '  "summary": "<一句话说明依据，20~40 字>",',
    '  "timeline": [<覆盖 1~12 月，每项形如>{"m": <月份1-12>, "score": <该月情绪分值，-100 最消极 ~ 100 最积极；该月无往来则为 null>}],',
    '  "me": {"tone": "<我方情绪基调短词>", "summary": "<一句话，20~40 字>"},',
    '  "them": {"tone": "<对方情绪基调短词>", "summary": "<一句话，20~40 字>"}',
    '}',
    '',
    '聚合统计：',
    `- 好友：${displayName}`,
    `- 关系标签：${friend.rel}`,
    `- 职务/备注：${friend.role || '（未填）'}`,
    `- 全年消息往来：${friend.msgCount} 条`,
    `- 我方发送占比：${friend.sentRatio}%`,
    `- 活跃时段：${friend.peakPeriod || '（无）'}`,
    `- 逐月消息数：${monthly}`,
    '',
    '（timeline 必须逐月给出：某月逐月消息数为 0 时该月 score 用 null，不要编造情绪。）',
    '',
    '部分聊天样本（「我」为用户本人，「对方」为该好友）：',
    sampleBlock,
  ].join('\n')
}
```

- [ ] **Step 4: 追加导出**

修改 `packages/core/src/index.ts` 第 18-19 行的两行为：

```typescript
export { buildFriendSentimentPrompt, buildYearSentimentPrompt, parseSentiment, buildFriendDeepSentimentPrompt } from './ai/sentiment'
export type { Sentiment, DeepSentiment, MoodTimelinePoint } from './ai/sentiment'
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/sentiment.test.ts`
Expected: PASS（含既有 parseSentiment / buildYearSentimentPrompt 用例）。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/ai/sentiment.ts packages/core/src/index.ts packages/core/src/ai/__tests__/sentiment.test.ts
git commit -m "feat(core): 深度情绪 prompt（逐月走势 + 双方对比）"
```

---

### Task 2: core — parseDeepSentiment 容错解析

**Files:**
- Modify: `packages/core/src/ai/sentiment.ts`（末尾追加函数）
- Modify: `packages/core/src/index.ts`（导出追加 `parseDeepSentiment`）
- Test: `packages/core/src/ai/__tests__/sentiment.test.ts`

**Interfaces:**
- Consumes: `DeepSentiment`、`MoodTimelinePoint`、`Sentiment`（Task 1）。
- Produces: `function parseDeepSentiment(text: string): DeepSentiment` —— 坏数据降级，永不抛异常；`timeline` 项过滤非法 `m`（非 1-12 整数丢弃），`score` 非有限数字归 `null` 并 clamp 到 [-100,100]；`me`/`them` 无有效字段则不设置。

- [ ] **Step 1: 写失败测试**

在 import 追加 `parseDeepSentiment`，并在文件末尾追加：

```typescript
describe('parseDeepSentiment', () => {
  it('解析 tone/summary/timeline/me/them 完整对象', () => {
    const r = parseDeepSentiment(JSON.stringify({
      tone: '热络', summary: '你们无话不谈',
      timeline: [{ m: 1, score: 40 }, { m: 2, score: null }, { m: 3, score: 200 }],
      me: { tone: '主动', summary: '我常先开口' },
      them: { tone: '克制', summary: 'TA 回得慢' },
    }))
    expect(r.tone).toBe('热络')
    expect(r.timeline).toEqual([{ m: 1, score: 40 }, { m: 2, score: null }, { m: 3, score: 100 }]) // 200→clamp 100
    expect(r.me?.tone).toBe('主动')
    expect(r.them?.summary).toBe('TA 回得慢')
  })
  it('剥代码围栏后仍能解析', () => {
    const r = parseDeepSentiment('```json\n{"tone":"渐远","timeline":[{"m":6,"score":-30}]}\n```')
    expect(r.tone).toBe('渐远')
    expect(r.timeline).toEqual([{ m: 6, score: -30 }])
  })
  it('过滤非法 m（越界/非整数）与非数字 score', () => {
    const r = parseDeepSentiment(JSON.stringify({
      timeline: [{ m: 0, score: 10 }, { m: 13, score: 10 }, { m: 5.5, score: 10 }, { m: 7, score: 'x' }],
    }))
    expect(r.timeline).toEqual([{ m: 7, score: null }]) // 只剩 m=7，score 非数字→null
  })
  it('缺 me/them 时不设置该字段', () => {
    const r = parseDeepSentiment('{"tone":"客套"}')
    expect(r.me).toBeUndefined()
    expect(r.them).toBeUndefined()
    expect(r.timeline).toBeUndefined()
  })
  it('垃圾输入返回空对象、不抛异常', () => {
    expect(parseDeepSentiment('不是 JSON')).toEqual({})
    expect(parseDeepSentiment('')).toEqual({})
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/sentiment.test.ts`
Expected: FAIL —— `parseDeepSentiment is not a function`。

- [ ] **Step 3: 实现**

在 `packages/core/src/ai/sentiment.ts` 末尾追加：

```typescript
function pickSentiment(v: unknown): Sentiment | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const r = v as Record<string, unknown>
  const out: Sentiment = {}
  if (typeof r.tone === 'string' && r.tone.trim() !== '') out.tone = r.tone.trim()
  if (typeof r.summary === 'string' && r.summary.trim() !== '') out.summary = r.summary.trim()
  return (out.tone || out.summary) ? out : undefined
}

/**
 * 容错解析深度情绪 JSON：剥围栏、定位首个 JSON；timeline 过滤非法项、clamp 分值；
 * me/them 无有效字段则不设置。无法解析返回 {}，永不抛异常。
 */
export function parseDeepSentiment(text: string): DeepSentiment {
  if (typeof text !== 'string') return {}
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return {}
  let obj: unknown
  try {
    obj = JSON.parse(text.slice(start, end + 1))
  } catch {
    return {}
  }
  if (typeof obj !== 'object' || obj === null) return {}
  const r = obj as Record<string, unknown>
  const out: DeepSentiment = {}
  if (typeof r.tone === 'string' && r.tone.trim() !== '') out.tone = r.tone.trim()
  if (typeof r.summary === 'string' && r.summary.trim() !== '') out.summary = r.summary.trim()

  if (Array.isArray(r.timeline)) {
    const tl: MoodTimelinePoint[] = []
    for (const item of r.timeline) {
      if (typeof item !== 'object' || item === null) continue
      const it = item as Record<string, unknown>
      const m = it.m
      if (typeof m !== 'number' || !Number.isInteger(m) || m < 1 || m > 12) continue
      let score: number | null = null
      if (typeof it.score === 'number' && Number.isFinite(it.score)) {
        score = Math.max(-100, Math.min(100, it.score))
      }
      tl.push({ m, score })
    }
    if (tl.length) out.timeline = tl
  }

  const me = pickSentiment(r.me)
  if (me) out.me = me
  const them = pickSentiment(r.them)
  if (them) out.them = them
  return out
}
```

- [ ] **Step 4: 追加导出**

修改 `packages/core/src/index.ts` 中 Task 1 已改的那一行，把 `parseDeepSentiment` 加入：

```typescript
export { buildFriendSentimentPrompt, buildYearSentimentPrompt, parseSentiment, buildFriendDeepSentimentPrompt, parseDeepSentiment } from './ai/sentiment'
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/sentiment.test.ts`
Expected: PASS。

- [ ] **Step 6: 构建 core（供 miniapp 解析新导出）**

Run: `pnpm --filter @nianlun/core build`
Expected: 成功产出 `dist/`。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/ai/sentiment.ts packages/core/src/index.ts packages/core/src/ai/__tests__/sentiment.test.ts
git commit -m "feat(core): parseDeepSentiment 容错解析逐月走势与双方情绪"
```

---

### Task 3: miniapp — moodLinePoints 折线坐标映射

**Files:**
- Modify: `packages/miniapp/src/lib/insights.ts`（末尾追加）
- Test: `packages/miniapp/src/lib/__tests__/insights.test.ts`

**Interfaces:**
- Consumes: `MoodTimelinePoint`（`@nianlun/core`，Task 1）。
- Produces:
  - `interface MoodLinePoint { m: number; score: number; x: number; y: number }`
  - `interface MoodLine { segments: MoodLinePoint[][]; midY: number; width: number; height: number; hasData: boolean }`
  - `function moodLinePoints(timeline: Array<{ m: number; score: number | null }>, opts: { width: number; height: number; padding: number }): MoodLine`
  - 语义：按 m=1..12 归位；连续有值点连成一段，遇 `null` 断开分段；`x` 按月份等距，`y` 按 score 映射（+100 顶、-100 底、0 中线）；分值 clamp [-100,100]。

- [ ] **Step 1: 写失败测试**

在 `packages/miniapp/src/lib/__tests__/insights.test.ts` 顶部 import 追加 `moodLinePoints`，文件末尾追加：

```typescript
describe('moodLinePoints', () => {
  const OPTS = { width: 320, height: 160, padding: 20 }

  it('空/全 null 时 hasData 为 false、segments 为空', () => {
    expect(moodLinePoints([], OPTS).hasData).toBe(false)
    const r = moodLinePoints([{ m: 1, score: null }, { m: 2, score: null }], OPTS)
    expect(r.hasData).toBe(false)
    expect(r.segments).toEqual([])
  })

  it('null 处断开分段', () => {
    const r = moodLinePoints(
      [{ m: 1, score: 10 }, { m: 2, score: 20 }, { m: 3, score: null }, { m: 4, score: 30 }],
      OPTS,
    )
    expect(r.segments).toHaveLength(2)
    expect(r.segments[0].map((p) => p.m)).toEqual([1, 2])
    expect(r.segments[1].map((p) => p.m)).toEqual([4])
  })

  it('坐标：m=1 在左内边、m=12 在右内边、score=0 在中线', () => {
    const r = moodLinePoints([{ m: 1, score: 0 }, { m: 12, score: 0 }], OPTS)
    expect(r.midY).toBe(80)
    expect(r.segments[0][0].x).toBeCloseTo(20)          // padding
    expect(r.segments[0][1].x).toBeCloseTo(300)         // width - padding
    expect(r.segments[0][0].y).toBeCloseTo(80)          // 0 → midY
  })

  it('分值 clamp 到 [-100,100]，+100 在顶、-100 在底', () => {
    const r = moodLinePoints([{ m: 1, score: 999 }, { m: 2, score: -999 }], OPTS)
    expect(r.segments[0][0].score).toBe(100)
    expect(r.segments[0][1].score).toBe(-100)
    expect(r.segments[0][0].y).toBeCloseTo(20)          // 顶 = padding
    expect(r.segments[0][1].y).toBeCloseTo(140)         // 底 = height - padding
  })

  it('忽略越界 m', () => {
    const r = moodLinePoints([{ m: 0, score: 10 } as any, { m: 5, score: 10 }], OPTS)
    expect(r.segments).toHaveLength(1)
    expect(r.segments[0][0].m).toBe(5)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/insights.test.ts`
Expected: FAIL —— `moodLinePoints is not a function`。

- [ ] **Step 3: 实现**

在 `packages/miniapp/src/lib/insights.ts` 末尾追加：

```typescript
export interface MoodLinePoint { m: number; score: number; x: number; y: number }
export interface MoodLine {
  segments: MoodLinePoint[][]
  midY: number
  width: number
  height: number
  hasData: boolean
}

/**
 * 逐月情绪 timeline → canvas 折线视图模型。
 * 按 m=1..12 归位；连续有值点连成一段，遇 null 断开；x 按月份等距，
 * y 按 score 映射（+100→顶 padding、-100→底 height-padding、0→中线）。分值 clamp[-100,100]。
 */
export function moodLinePoints(
  timeline: Array<{ m: number; score: number | null }>,
  opts: { width: number; height: number; padding: number },
): MoodLine {
  const { width, height, padding } = opts
  const midY = height / 2
  const halfH = (height - 2 * padding) / 2
  const innerW = width - 2 * padding

  const byMonth = new Array<number | null>(12).fill(null)
  for (const p of timeline ?? []) {
    if (!p || typeof p.m !== 'number' || !Number.isInteger(p.m) || p.m < 1 || p.m > 12) continue
    if (typeof p.score !== 'number' || !Number.isFinite(p.score)) continue
    byMonth[p.m - 1] = Math.max(-100, Math.min(100, p.score))
  }

  const xOf = (m: number) => padding + ((m - 1) / 11) * innerW
  const yOf = (score: number) => midY - (score / 100) * halfH

  const segments: MoodLinePoint[][] = []
  let cur: MoodLinePoint[] = []
  for (let i = 0; i < 12; i++) {
    const s = byMonth[i]
    if (s === null) {
      if (cur.length) { segments.push(cur); cur = [] }
      continue
    }
    cur.push({ m: i + 1, score: s, x: xOf(i + 1), y: yOf(s) })
  }
  if (cur.length) segments.push(cur)

  return { segments, midY, width, height, hasData: segments.length > 0 }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/insights.test.ts`
Expected: PASS（含既有 wordCloudItems/weekHourHeatmap/monthlyTrend 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/lib/insights.ts packages/miniapp/src/lib/__tests__/insights.test.ts
git commit -m "feat(miniapp): moodLinePoints 逐月情绪折线坐标映射"
```

---

### Task 4: miniapp — aiClient 改用深度情绪

**Files:**
- Modify: `packages/miniapp/src/adapters/aiClient.ts:1-5, 18-21`
- Test: `packages/miniapp/src/adapters/__tests__/aiClient.test.ts`

**前置：** Task 2 Step 6 已 `pnpm --filter @nianlun/core build`。若未做，先执行它，否则 `@nianlun/core` 无 `parseDeepSentiment` 导出。

**Interfaces:**
- Consumes: `buildFriendDeepSentimentPrompt`、`parseDeepSentiment`、`DeepSentiment`（`@nianlun/core`）。
- Produces: `aiClient.analyzeFriendSentiment(friend, samples): Promise<DeepSentiment>`（返回类型由 `Sentiment` 变为 `DeepSentiment`，向后兼容 tone/summary）。

- [ ] **Step 1: 写失败测试**

在 `packages/miniapp/src/adapters/__tests__/aiClient.test.ts` 的 `analyzeFriendSentiment 解析 tone/summary` 用例**之后**追加：

```typescript
  it('analyzeFriendSentiment 走深度 prompt 并解析 timeline/me/them', async () => {
    const transport = vi.fn().mockResolvedValue(JSON.stringify({
      tone: '热络', summary: '你们无话不谈',
      timeline: [{ m: 1, score: 40 }, { m: 2, score: null }],
      me: { tone: '主动', summary: '我常先开口' },
      them: { tone: '克制', summary: 'TA 回得慢' },
    }))
    const out = await makeAiClient(transport).analyzeFriendSentiment(FRIEND, ['我：哈哈', '对方：笑死'])
    expect(out.timeline).toEqual([{ m: 1, score: 40 }, { m: 2, score: null }])
    expect(out.me?.tone).toBe('主动')
    expect(out.them?.tone).toBe('克制')
    expect(transport.mock.calls[0][0]).toContain('timeline') // 走的是深度 prompt
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/aiClient.test.ts`
Expected: FAIL —— `out.timeline` 为 undefined（仍走旧 prompt/parser）。

- [ ] **Step 3: 实现**

修改 `packages/miniapp/src/adapters/aiClient.ts` 第 1-5 行的 import：

```typescript
import {
  buildReportCopyPrompt, buildFriendSuggestionPrompt, parseFriendSuggestion,
  buildYearSentimentPrompt, buildFriendDeepSentimentPrompt, parseDeepSentiment,
} from '@nianlun/core'
import type { Friend, ReportData, FriendSuggestion, DeepSentiment } from '@nianlun/core'
```

修改第 18-21 行的 `analyzeFriendSentiment` 方法为：

```typescript
    async analyzeFriendSentiment(friend: Friend, samples: string[]): Promise<DeepSentiment> {
      const text = await transport(buildFriendDeepSentimentPrompt(friend, samples), 1024)
      return parseDeepSentiment(text)
    },
```

（`buildFriendSentimentPrompt`/`parseSentiment`/`Sentiment` 不再被 aiClient 引用，从 import 中移除即可；core 仍保留导出，勿删 core 侧。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/aiClient.test.ts`
Expected: PASS（既有 `analyzeFriendSentiment 解析 tone/summary` 用例仍通过——深度 prompt 含「张三」，parseDeepSentiment 解析 tone/summary）。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/aiClient.ts packages/miniapp/src/adapters/__tests__/aiClient.test.ts
git commit -m "feat(miniapp): aiClient 情绪分析改用深度 prompt/parser"
```

---

### Task 5: miniapp — friend-detail 页折线 canvas + 双方对比 UI

**Files:**
- Modify: `packages/miniapp/src/pages/friend-detail/friend-detail.vue`（script + template + style）

**Interfaces:**
- Consumes: `aiClient.analyzeFriendSentiment` 返回的 `DeepSentiment`（Task 4）、`moodLinePoints`（Task 3）。
- Produces: 无对外接口（页面级）。此任务无单测（逻辑已在 Task 3/4 的纯函数覆盖），以类型检查 + 构建 + 开发者工具手测验证。

- [ ] **Step 1: script —— 类型、import、canvas 绘制、调用时机**

修改 `friend-detail.vue`：

第 2 行 `import { ref, computed } from 'vue'` 改为：
```typescript
import { ref, computed, nextTick } from 'vue'
```

第 4 行 `import type { Relation } from '@nianlun/core'` 改为：
```typescript
import type { Relation, DeepSentiment } from '@nianlun/core'
```

第 8 行 import 追加 `moodLinePoints`：
```typescript
import { wordCloudItems, weekHourHeatmap, monthlyTrend, moodLinePoints } from '../../lib/insights'
```

第 80 行 `const sentiment = ref<{ tone?: string; summary?: string } | null>(null)` 改为：
```typescript
const sentiment = ref<DeepSentiment | null>(null)
// 折线块只在存在至少一个非 null 月份时显示，避免全 null 时出现空白 canvas 框。
const hasMoodLine = computed(() => !!sentiment.value?.timeline?.some((p) => p.score !== null))
const MOOD_W = 320
const MOOD_H = 160
function drawMood() {
  const tl = sentiment.value?.timeline
  if (!tl || !tl.length) return
  const line = moodLinePoints(tl, { width: MOOD_W, height: MOOD_H, padding: 24 })
  if (!line.hasData) return
  const ctx = uni.createCanvasContext('mood')
  ctx.setFillStyle('#ffffff'); ctx.fillRect(0, 0, MOOD_W, MOOD_H)
  // 0 中线
  ctx.setStrokeStyle('#d8d2c4'); ctx.setLineWidth(1)
  ctx.beginPath(); ctx.moveTo(24, line.midY); ctx.lineTo(MOOD_W - 24, line.midY); ctx.stroke()
  // 折线段（null 处断开）
  ctx.setStrokeStyle('#10a37a'); ctx.setLineWidth(2); ctx.setFillStyle('#10a37a')
  for (const seg of line.segments) {
    if (seg.length === 1) {
      const p = seg[0]
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI); ctx.fill()
      continue
    }
    ctx.beginPath()
    seg.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y) })
    ctx.stroke()
  }
  // 月份刻度
  ctx.setFillStyle('#9a917f'); ctx.setFontSize(11); ctx.setTextAlign('center')
  for (const m of [1, 4, 7, 10, 12]) {
    const px = 24 + ((m - 1) / 11) * (MOOD_W - 48)
    ctx.fillText(`${m}月`, px, MOOD_H - 6)
  }
  ctx.draw()
}
```

第 96-97 行（`analyzeSentiment` 内成功赋值处）：
```typescript
    const r = await aiClient.analyzeFriendSentiment(f, s)
    sentiment.value = (r.tone || r.summary || r.timeline?.length || r.me || r.them) ? r : { summary: 'AI 无法判断情绪' }
```
改为在赋值后追加绘制（`sentiment.value = ...` 那行保持上面这版，其后加两行）：
```typescript
    const r = await aiClient.analyzeFriendSentiment(f, s)
    sentiment.value = (r.tone || r.summary || r.timeline?.length || r.me || r.them) ? r : { summary: 'AI 无法判断情绪' }
    await nextTick()
    drawMood()
```

- [ ] **Step 2: template —— 折线块 + 双方对比块**

在 `friend-detail.vue` template 中，现有情绪卡片块（`<view v-if="sentiment" class="senti">…</view>` 所在的 `card block`，约第 180-192 行）**之后**、聊天样本块之前，插入两块：

```html
      <view v-if="hasMoodLine" class="card block">
        <text class="block-t">情绪波动 · 逐月</text>
        <canvas canvas-id="mood" class="mood-canvas" :style="{ width: '320px', height: '160px' }"></canvas>
        <text class="senti-note faint">AI 推测，仅供参考</text>
      </view>

      <view v-if="sentiment && (sentiment.me || sentiment.them)" class="card block">
        <text class="block-t">双方情绪对比</text>
        <view class="dual">
          <view class="dual-col">
            <text class="dual-who">我</text>
            <view v-if="sentiment.me && sentiment.me.tone" class="senti-tone">{{ sentiment.me.tone }}</view>
            <text v-if="sentiment.me && sentiment.me.summary" class="dual-sum">{{ sentiment.me.summary }}</text>
          </view>
          <view class="dual-col">
            <text class="dual-who">{{ friend.alias || friend.name }}</text>
            <view v-if="sentiment.them && sentiment.them.tone" class="senti-tone">{{ sentiment.them.tone }}</view>
            <text v-if="sentiment.them && sentiment.them.summary" class="dual-sum">{{ sentiment.them.summary }}</text>
          </view>
        </view>
        <text class="senti-note faint">AI 推测，仅供参考</text>
      </view>
```

- [ ] **Step 3: style —— 折线与双方对比样式**

在 `friend-detail.vue` `<style scoped>` 内，`.senti-note` 规则（约第 263 行）之后追加：

```css
.mood-canvas { display: block; margin: 24rpx auto 8rpx; }
.dual { display: flex; gap: 20rpx; margin-top: 24rpx; }
.dual-col { flex: 1; padding: 24rpx; background: var(--accent-wash); border-radius: 16rpx; text-align: center; }
.dual-who { display: block; font-size: 24rpx; color: var(--muted); margin-bottom: 14rpx; }
.dual-sum { display: block; margin-top: 14rpx; font-size: 24rpx; color: var(--fg); line-height: 1.6; }
```

- [ ] **Step 4: 类型检查 + 构建**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 编译通过、`DONE Build complete.`、且末行 `[postbuild-cloud] 已拷贝 cloudfunctions 并设置 cloudfunctionRoot`。

- [ ] **Step 5: 开发者工具手测**

微信开发者工具导入 `packages/miniapp/dist/build/mp-weixin`，进入任一好友详情页点「✦ 情绪分析」，确认：
- 出现「情绪波动 · 逐月」折线，无往来的月断开、有 0 中线与月份刻度；
- 出现「双方情绪对比」两栏（我 / 好友名），各有基调徽章 + 一句说明；
- 顶部原有整体 tone/summary 仍在；三块都带「AI 推测，仅供参考」。

- [ ] **Step 6: 提交**

```bash
git add packages/miniapp/src/pages/friend-detail/friend-detail.vue
git commit -m "feat(miniapp): 好友详情页情绪波动折线 + 双方情绪对比"
```

---

## 说明 / 边界

- **timeline 全 null**：折线块 `v-if="hasMoodLine"`（timeline 存在至少一个非 null 分值才为真），全 null 时**整块不显示**，不会出现空白 canvas 框。`drawMood` 另有 `line.hasData` 兜底（全 null 时直接 return）。如需「样本不足」占位可后续再加，不在本次范围。
- **canvas 尺寸固定 320×160 px**：小程序旧版 `createCanvasContext` 按 CSS px 绘制，`:style` 与绘制常量一致即可，不处理 DPR（够用）。
- **不持久化**：刷新后 `sentiment.value` 归 null，需重新点按钮，与现有 tone/summary 行为一致。

## 不在本次范围
- 情绪持久化、年度报告页全年走势、三档分布/情绪指数等更重形态。
