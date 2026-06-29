# 聊天图表功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为「年轮」新增三类可视化（时段柱状图 / 周×时热力图 / 词频统计），全局年度 + 单好友下钻两个层面都提供。

**Architecture:** core 在 Worker 里把 `hourly[24]`、`weekHour[168]`、`keywords[]` 算进每个 `Friend`（唯一真相源，随 `Friend[]` 落盘）；全局图由对 `Friend[]` 求和的纯函数派生。中文分词用内置 `Intl.Segmenter`（零依赖）。图表用手写 SVG/CSS 组件（零图表库）。

**Tech Stack:** TypeScript（core，`lib: ES2020`、`types: []`）、Vue 3 + vue-router + Pinia（web）、Vitest（core 纯函数 / web jsdom + @vue/test-utils）。

## Global Constraints

- core 永不 import web，永不触碰 `window/document/IndexedDB/vue`；只用 `Intl`（ECMAScript 标准，非 DOM）。
- 原始 `Conversation[]` 绝不离开 Worker、绝不落盘；只持久化聚合结果。
- 不引入任何第三方依赖（分词用 `Intl.Segmenter`，图表手写）。
- `weekHour` 存储索引 = `getDay()`（0=周日）`* 24 + getHours()`；**显示层重排为周一开头**。
- 每好友 `keywords` 取 **Top 20**；全局 `keywords` 取 **Top 50**。
- 时间戳为毫秒 `number`；`Relation` 从 `model/types` import，绝不重定义。
- 提交信息结尾加：`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 命令用 pnpm；core 测试 `pnpm --filter @nianlun/core exec vitest run <file>`，web 测试 `pnpm --filter @nianlun/web exec vitest run <file>`。

---

### Task 1: core 中文分词模块

**Files:**
- Create: `packages/core/src/intl-segmenter.d.ts`
- Create: `packages/core/src/stats/stopwords.ts`
- Create: `packages/core/src/stats/segment.ts`
- Test: `packages/core/src/stats/__tests__/segment.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `tokenize(text: string): string[]` —— 分词 + 过滤后的词数组。
  - `countWords(texts: Iterable<string>, topN: number): Array<{ word: string; count: number }>` —— 累计计数、`count` 降序、取前 `topN`。

- [ ] **Step 1: 写失败测试**

`packages/core/src/stats/__tests__/segment.test.ts`：
```ts
import { describe, it, expect } from 'vitest'
import { tokenize, countWords } from '../segment'

describe('tokenize', () => {
  it('切出中文词，过滤单字、标点、数字与停用词', () => {
    const words = tokenize('我今天去公司开会了，123 哈哈')
    expect(words).toContain('今天')
    expect(words).toContain('公司')
    expect(words).toContain('开会')
    expect(words).not.toContain('我')   // 停用词
    expect(words).not.toContain('了')   // 单字 + 停用词
    expect(words).not.toContain('，')   // 标点
    expect(words).not.toContain('123')  // 纯数字
  })

  it('保留长度≥2的英文词', () => {
    expect(tokenize('ok deadline')).toContain('deadline')
  })
})

describe('countWords', () => {
  it('累计计数并按降序取 topN', () => {
    const top = countWords(['开会 开会 吃饭', '开会 吃饭'], 1)
    expect(top).toEqual([{ word: '开会', count: 3 }])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/stats/__tests__/segment.test.ts`
Expected: FAIL（`Cannot find module '../segment'`）

- [ ] **Step 3: 写 `Intl.Segmenter` 类型声明**

`packages/core/src/intl-segmenter.d.ts`（core 的 `lib: ES2020` 不含 Segmenter 类型，补最小声明，合并进全局 `Intl`）：
```ts
declare namespace Intl {
  interface SegmentData {
    segment: string
    index: number
    isWordLike?: boolean
  }
  interface Segments {
    [Symbol.iterator](): IterableIterator<SegmentData>
  }
  interface Segmenter {
    segment(input: string): Segments
  }
  const Segmenter: {
    new (
      locales?: string | string[],
      options?: { granularity?: 'grapheme' | 'word' | 'sentence' },
    ): Segmenter
  }
}
```

- [ ] **Step 4: 写停用词表**

`packages/core/src/stats/stopwords.ts`：
```ts
// 常见中文停用词（高频虚词/代词等），用于过滤词频噪声。可按需扩充。
export const STOPWORDS = new Set<string>([
  '我们', '你们', '他们', '自己', '这个', '那个', '什么', '怎么', '可以', '没有',
  '就是', '这样', '那样', '一个', '现在', '知道', '不是', '这么', '还是', '已经',
  '因为', '所以', '但是', '如果', '然后', '这种', '一下', '一些', '时候', '应该',
  '觉得', '感觉', '还有', '可能', '其实', '不过', '只是', '这里', '那里', '东西',
])
```

- [ ] **Step 5: 写 `segment.ts`**

`packages/core/src/stats/segment.ts`：
```ts
import { STOPWORDS } from './stopwords'

const HAS_CJK = /[一-鿿]/
const EN_WORD = /^[a-zA-Z]{2,}$/

export function tokenize(text: string): string[] {
  const seg = new Intl.Segmenter('zh', { granularity: 'word' })
  const out: string[] = []
  for (const s of seg.segment(text)) {
    if (!s.isWordLike) continue
    const w = s.segment
    if (w.length < 2) continue
    if (!HAS_CJK.test(w) && !EN_WORD.test(w)) continue // 丢纯数字/标点/符号
    if (STOPWORDS.has(w)) continue
    out.push(w)
  }
  return out
}

export function countWords(
  texts: Iterable<string>,
  topN: number,
): Array<{ word: string; count: number }> {
  const counts = new Map<string, number>()
  for (const text of texts) {
    for (const w of tokenize(text)) counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }))
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/stats/__tests__/segment.test.ts`
Expected: PASS（若报 `Intl.Segmenter is not defined`，说明本机 Node < 16；本项目假定 Node 16+，请升级 Node）

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/intl-segmenter.d.ts packages/core/src/stats/stopwords.ts packages/core/src/stats/segment.ts packages/core/src/stats/__tests__/segment.test.ts
git commit -m "feat(core): add Chinese tokenizer via Intl.Segmenter with stopword filter"
```

---

### Task 2: Friend 新增统计字段

**Files:**
- Modify: `packages/core/src/model/types.ts:17-31`（`Friend` 接口）
- Modify: `packages/core/src/model/friend.ts:3-19`（`createFriend`）
- Test: `packages/core/src/model/__tests__/friend.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `Friend` 新增 `hourly: number[]`、`weekHour: number[]`、`keywords: Array<{ word: string; count: number }>`；`createFriend(id, name)` 将其初始化为全 0 / 空数组。

- [ ] **Step 1: 写失败测试**

在 `packages/core/src/model/__tests__/friend.test.ts` 追加：
```ts
import { describe, it, expect } from 'vitest'
import { createFriend } from '../friend'

describe('createFriend 新统计字段', () => {
  it('初始化 hourly/weekHour/keywords', () => {
    const f = createFriend('a', 'A')
    expect(f.hourly).toHaveLength(24)
    expect(f.hourly.every((n) => n === 0)).toBe(true)
    expect(f.weekHour).toHaveLength(168)
    expect(f.weekHour.every((n) => n === 0)).toBe(true)
    expect(f.keywords).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/model/__tests__/friend.test.ts`
Expected: FAIL（`hourly` 等属性不存在 / undefined）

- [ ] **Step 3: 改 `Friend` 接口**

`packages/core/src/model/types.ts`，在 `monthly: number[]` 行后、`userEdited` 前插入：
```ts
  hourly: number[]       // 长度 24，按小时(0–23)消息数
  weekHour: number[]     // 长度 168，索引 = getDay(0=周日)*24 + 小时
  keywords: Array<{ word: string; count: number }>  // 该好友 Top 20 高频词
```

- [ ] **Step 4: 改 `createFriend`**

`packages/core/src/model/friend.ts`，在 `monthly: new Array(12).fill(0),` 后插入：
```ts
    hourly: new Array(24).fill(0),
    weekHour: new Array(168).fill(0),
    keywords: [],
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/model/__tests__/friend.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/model/types.ts packages/core/src/model/friend.ts packages/core/src/model/__tests__/friend.test.ts
git commit -m "feat(core): add hourly/weekHour/keywords fields to Friend"
```

---

### Task 3: aggregate 填充新字段

**Files:**
- Modify: `packages/core/src/stats/aggregate.ts`
- Test: `packages/core/src/stats/__tests__/aggregate.test.ts`

**Interfaces:**
- Consumes: `countWords`（Task 1）、`Friend.hourly/weekHour/keywords`（Task 2）。
- Produces: `aggregate(conversations)` 产出的每个 `Friend` 的 `hourly`/`weekHour`/`keywords` 已按消息时间与文本填充。

- [ ] **Step 1: 写失败测试**

在 `packages/core/src/stats/__tests__/aggregate.test.ts` 追加（文件顶部已有 `const t = (s) => new Date(s).getTime()`）：
```ts
import { aggregate } from '../aggregate'

describe('aggregate 时段/热力/词频', () => {
  it('按小时与星期分桶，并算词频', () => {
    const c = {
      id: 'A', peerName: 'A', isGroup: false,
      messages: [
        // 2025-01-06 是周一，10 点
        { ts: t('2025-01-06T10:00:00'), from: 'them' as const, type: 'text' as const, text: '今天开会' },
        { ts: t('2025-01-06T10:30:00'), from: 'me' as const, type: 'text' as const, text: '好的开会' },
      ],
    }
    const f = aggregate([c])[0]
    expect(f.hourly[10]).toBe(2)
    // 周一 getDay()===1 → 索引 1*24+10 = 34
    expect(f.weekHour[34]).toBe(2)
    expect(f.keywords[0]).toEqual({ word: '开会', count: 2 })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/stats/__tests__/aggregate.test.ts`
Expected: FAIL（`f.hourly[10]` 为 0 / `keywords` 为空）

- [ ] **Step 3: 改 `aggregate.ts`**

`packages/core/src/stats/aggregate.ts` 改为：
```ts
import type { Conversation, Friend } from '../model/types'
import { createFriend } from '../model/friend'
import { countWords } from './segment'

export function aggregate(conversations: Conversation[]): Friend[] {
  return conversations.map((c) => {
    const f = createFriend(c.id, c.peerName)
    const msgs = c.messages
    f.msgCount = msgs.length
    if (msgs.length === 0) return f

    let sent = 0
    let first = Infinity
    let last = -Infinity
    const texts: string[] = []
    for (const m of msgs) {
      if (m.from === 'me') sent++
      if (m.ts && m.ts < first) first = m.ts
      if (m.ts && m.ts > last) last = m.ts
      if (m.ts) {
        const d = new Date(m.ts)
        f.monthly[d.getMonth()]++
        f.hourly[d.getHours()]++
        f.weekHour[d.getDay() * 24 + d.getHours()]++
      }
      if (m.type === 'text' && m.text) texts.push(m.text)
    }
    f.keywords = countWords(texts, 20)
    f.sentRatio = Math.round((sent / msgs.length) * 100)
    f.firstContact = first === Infinity ? 0 : first
    f.lastContact = last === -Infinity ? 0 : last
    return f
  })
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/stats/__tests__/aggregate.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/stats/aggregate.ts packages/core/src/stats/__tests__/aggregate.test.ts
git commit -m "feat(core): populate hourly/weekHour/keywords in aggregate"
```

---

### Task 4: 全局派生函数 + buildReport keywords + 导出

**Files:**
- Create: `packages/core/src/stats/global.ts`
- Test: `packages/core/src/stats/__tests__/global.test.ts`
- Modify: `packages/core/src/stats/report.ts:42`（`keywords: []`）
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Friend.hourly/weekHour/keywords`（Task 2/3）。
- Produces:
  - `sumHourly(friends: Friend[]): number[]`（长度 24）
  - `sumWeekHour(friends: Friend[]): number[]`（长度 168）
  - `mergeKeywords(friends: Friend[], topN: number): Array<{ word: string; count: number }>`
  - 三者经 `@nianlun/core` 导出；`buildReport` 的 `keywords` 由 `mergeKeywords(friends, 50)` 填充。

- [ ] **Step 1: 写失败测试**

`packages/core/src/stats/__tests__/global.test.ts`：
```ts
import { describe, it, expect } from 'vitest'
import { sumHourly, sumWeekHour, mergeKeywords } from '../global'
import { createFriend } from '../../model/friend'

function fr(over: Partial<ReturnType<typeof createFriend>>) {
  return { ...createFriend('x', 'x'), ...over }
}

describe('global 派生', () => {
  it('sumHourly 逐位求和', () => {
    const a = fr({ hourly: Array.from({ length: 24 }, (_, i) => (i === 9 ? 2 : 0)) })
    const b = fr({ hourly: Array.from({ length: 24 }, (_, i) => (i === 9 ? 3 : 0)) })
    expect(sumHourly([a, b])[9]).toBe(5)
  })
  it('sumWeekHour 逐位求和', () => {
    const a = fr({ weekHour: Array.from({ length: 168 }, (_, i) => (i === 34 ? 1 : 0)) })
    const b = fr({ weekHour: Array.from({ length: 168 }, (_, i) => (i === 34 ? 4 : 0)) })
    expect(sumWeekHour([a, b])[34]).toBe(5)
  })
  it('mergeKeywords 合并计数并取 topN', () => {
    const a = fr({ keywords: [{ word: '开会', count: 3 }, { word: '吃饭', count: 1 }] })
    const b = fr({ keywords: [{ word: '开会', count: 2 }] })
    expect(mergeKeywords([a, b], 1)).toEqual([{ word: '开会', count: 5 }])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/stats/__tests__/global.test.ts`
Expected: FAIL（`Cannot find module '../global'`）

- [ ] **Step 3: 写 `global.ts`**

`packages/core/src/stats/global.ts`：
```ts
import type { Friend } from '../model/types'

export function sumHourly(friends: Friend[]): number[] {
  const out = new Array(24).fill(0)
  for (const f of friends) for (let i = 0; i < 24; i++) out[i] += f.hourly[i] ?? 0
  return out
}

export function sumWeekHour(friends: Friend[]): number[] {
  const out = new Array(168).fill(0)
  for (const f of friends) for (let i = 0; i < 168; i++) out[i] += f.weekHour[i] ?? 0
  return out
}

export function mergeKeywords(
  friends: Friend[],
  topN: number,
): Array<{ word: string; count: number }> {
  const counts = new Map<string, number>()
  for (const f of friends) {
    for (const k of f.keywords) counts.set(k.word, (counts.get(k.word) ?? 0) + k.count)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }))
}
```

- [ ] **Step 4: 改 `buildReport` 的 keywords**

`packages/core/src/stats/report.ts`：顶部加 import，并把 `keywords: []` 改为派生值。
- 在文件首部 import 区加：`import { mergeKeywords } from './global'`
- 把第 42 行 `keywords: [],` 改为 `keywords: mergeKeywords(friends, 50),`

- [ ] **Step 5: 导出新函数**

`packages/core/src/index.ts`，在 `export { buildReport } ...` 行后加：
```ts
export { sumHourly, sumWeekHour, mergeKeywords } from './stats/global'
export { tokenize, countWords } from './stats/segment'
```

- [ ] **Step 6: 运行测试确认通过（含 report 回归）**

Run: `pnpm --filter @nianlun/core exec vitest run src/stats/__tests__/global.test.ts src/stats/__tests__/report.test.ts`
Expected: PASS（report 既有用例不应因 keywords 改动而失败；若旧用例硬断言 `keywords` 为 `[]`，改为断言为数组）

- [ ] **Step 7: 全量 core 测试 + 构建**

Run: `pnpm --filter @nianlun/core test`，然后 `pnpm --filter @nianlun/core build`
Expected: 全绿；build 成功（web 依赖 core 的 dist）

- [ ] **Step 8: 提交**

```bash
git add packages/core/src/stats/global.ts packages/core/src/stats/__tests__/global.test.ts packages/core/src/stats/report.ts packages/core/src/index.ts
git commit -m "feat(core): add global hourly/weekHour/keyword derivations and wire report keywords"
```

---

### Task 5: HourBars 图表组件

**Files:**
- Create: `packages/web/src/components/charts/HourBars.vue`
- Test: `packages/web/src/components/charts/__tests__/HourBars.test.ts`

**Interfaces:**
- Consumes: 无（纯展示）。
- Produces: `<HourBars :hourly="number[]" />`，渲染 24 根柱子，每根带 `data-h` 属性（0–23）与按峰值归一化的高度。

- [ ] **Step 1: 写失败测试**

`packages/web/src/components/charts/__tests__/HourBars.test.ts`：
```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import HourBars from '../HourBars.vue'

describe('HourBars', () => {
  it('渲染 24 根柱子', () => {
    const hourly = Array.from({ length: 24 }, (_, i) => i)
    const w = mount(HourBars, { props: { hourly } })
    expect(w.findAll('[data-h]')).toHaveLength(24)
  })

  it('峰值柱子高度最高', () => {
    const hourly = new Array(24).fill(0); hourly[10] = 100
    const w = mount(HourBars, { props: { hourly } })
    const bar = w.find('[data-h="10"]')
    expect(bar.attributes('style')).toContain('height: 100%')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run src/components/charts/__tests__/HourBars.test.ts`
Expected: FAIL（找不到组件）

- [ ] **Step 3: 写组件**

`packages/web/src/components/charts/HourBars.vue`：
```vue
<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ hourly: number[] }>()
const max = computed(() => Math.max(1, ...props.hourly))
function pct(n: number) { return `${Math.round((n / max.value) * 100)}%` }
</script>

<template>
  <div class="hour-bars">
    <div
      v-for="(n, h) in hourly"
      :key="h"
      class="bar"
      :data-h="h"
      :style="{ height: pct(n) }"
      :title="`${h} 时：${n} 条`"
    />
  </div>
</template>

<style scoped>
.hour-bars { display: flex; align-items: flex-end; gap: 2px; height: 120px; }
.bar { flex: 1; min-height: 1px; background: var(--accent, #c89b3c); border-radius: 2px 2px 0 0; }
</style>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run src/components/charts/__tests__/HourBars.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/components/charts/HourBars.vue packages/web/src/components/charts/__tests__/HourBars.test.ts
git commit -m "feat(web): add HourBars chart component"
```

---

### Task 6: WeekHourHeatmap 热力图组件

**Files:**
- Create: `packages/web/src/components/charts/WeekHourHeatmap.vue`
- Test: `packages/web/src/components/charts/__tests__/WeekHourHeatmap.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `<WeekHourHeatmap :weekHour="number[168]" />`，渲染 168 个格子，**显示按周一开头**（行序 周一…周日，即 `getDay` 1,2,3,4,5,6,0）；每格 `data-cell="<row>-<hour>"`（row 0=周一）、按峰值映射不透明度。

- [ ] **Step 1: 写失败测试**

`packages/web/src/components/charts/__tests__/WeekHourHeatmap.test.ts`：
```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import WeekHourHeatmap from '../WeekHourHeatmap.vue'

describe('WeekHourHeatmap', () => {
  it('渲染 168 个格子', () => {
    const w = mount(WeekHourHeatmap, { props: { weekHour: new Array(168).fill(0) } })
    expect(w.findAll('[data-cell]')).toHaveLength(168)
  })

  it('周一开头：存储索引 34（周一10点）落在显示行0、10点格', () => {
    const data = new Array(168).fill(0); data[34] = 5 // getDay 1 *24+10
    const w = mount(WeekHourHeatmap, { props: { weekHour: data } })
    const cell = w.find('[data-cell="0-10"]') // row0=周一
    expect(cell.attributes('title')).toContain('5')
  })

  it('周日（存储索引 0..23）排到显示最后一行 row6', () => {
    const data = new Array(168).fill(0); data[10] = 7 // getDay 0(周日) 10点
    const w = mount(WeekHourHeatmap, { props: { weekHour: data } })
    expect(w.find('[data-cell="6-10"]').attributes('title')).toContain('7')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run src/components/charts/__tests__/WeekHourHeatmap.test.ts`
Expected: FAIL（找不到组件）

- [ ] **Step 3: 写组件**

`packages/web/src/components/charts/WeekHourHeatmap.vue`：
```vue
<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ weekHour: number[] }>()
// 显示行序：周一..周日，对应 getDay 1,2,3,4,5,6,0
const DISPLAY_DAYS = [1, 2, 3, 4, 5, 6, 0]
const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const hours = Array.from({ length: 24 }, (_, h) => h)
const max = computed(() => Math.max(1, ...props.weekHour))
function val(day: number, hour: number) { return props.weekHour[day * 24 + hour] ?? 0 }
function alpha(n: number) { return n === 0 ? 0.04 : 0.15 + 0.85 * (n / max.value) }
</script>

<template>
  <div class="heatmap">
    <div v-for="(day, row) in DISPLAY_DAYS" :key="day" class="hm-row">
      <span class="hm-label">{{ DAY_LABELS[row] }}</span>
      <span
        v-for="h in hours"
        :key="h"
        class="hm-cell"
        :data-cell="`${row}-${h}`"
        :style="{ backgroundColor: `rgba(200,155,60,${alpha(val(day, h))})` }"
        :title="`周${DAY_LABELS[row]} ${h} 时：${val(day, h)} 条`"
      />
    </div>
  </div>
</template>

<style scoped>
.heatmap { display: flex; flex-direction: column; gap: 2px; }
.hm-row { display: flex; align-items: center; gap: 2px; }
.hm-label { width: 1.5em; font-size: 12px; color: #888; text-align: center; }
.hm-cell { width: 12px; height: 12px; border-radius: 2px; }
</style>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run src/components/charts/__tests__/WeekHourHeatmap.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/components/charts/WeekHourHeatmap.vue packages/web/src/components/charts/__tests__/WeekHourHeatmap.test.ts
git commit -m "feat(web): add WeekHourHeatmap chart component (Monday-first)"
```

---

### Task 7: WordRanks 词频组件

**Files:**
- Create: `packages/web/src/components/charts/WordRanks.vue`
- Test: `packages/web/src/components/charts/__tests__/WordRanks.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `<WordRanks :keywords="Array<{word,count}>" />`，渲染排行榜行（词 + 条形 + 次数）；空数组时显示占位文案。

- [ ] **Step 1: 写失败测试**

`packages/web/src/components/charts/__tests__/WordRanks.test.ts`：
```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import WordRanks from '../WordRanks.vue'

describe('WordRanks', () => {
  it('每个词一行，显示词与次数', () => {
    const w = mount(WordRanks, { props: { keywords: [{ word: '开会', count: 5 }, { word: '吃饭', count: 2 }] } })
    expect(w.findAll('[data-word]')).toHaveLength(2)
    expect(w.text()).toContain('开会')
    expect(w.text()).toContain('5')
  })

  it('空时显示占位', () => {
    const w = mount(WordRanks, { props: { keywords: [] } })
    expect(w.text()).toMatch(/暂无|没有/)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run src/components/charts/__tests__/WordRanks.test.ts`
Expected: FAIL（找不到组件）

- [ ] **Step 3: 写组件**

`packages/web/src/components/charts/WordRanks.vue`：
```vue
<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ keywords: Array<{ word: string; count: number }> }>()
const max = computed(() => Math.max(1, ...props.keywords.map((k) => k.count)))
function pct(n: number) { return `${Math.round((n / max.value) * 100)}%` }
</script>

<template>
  <div class="word-ranks">
    <p v-if="keywords.length === 0" class="empty">暂无高频词</p>
    <div v-for="k in keywords" :key="k.word" class="row" :data-word="k.word">
      <span class="w">{{ k.word }}</span>
      <span class="bar"><span class="fill" :style="{ width: pct(k.count) }" /></span>
      <span class="c">{{ k.count }}</span>
    </div>
  </div>
</template>

<style scoped>
.word-ranks { display: flex; flex-direction: column; gap: 4px; }
.row { display: grid; grid-template-columns: 4em 1fr 3em; align-items: center; gap: 8px; }
.w { font-size: 14px; }
.bar { background: #eee; border-radius: 3px; height: 10px; overflow: hidden; }
.fill { display: block; height: 100%; background: var(--accent, #c89b3c); }
.c { text-align: right; font-size: 12px; color: #888; }
.empty { color: #aaa; font-size: 13px; }
</style>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run src/components/charts/__tests__/WordRanks.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/components/charts/WordRanks.vue packages/web/src/components/charts/__tests__/WordRanks.test.ts
git commit -m "feat(web): add WordRanks chart component"
```

---

### Task 8: 好友详情页 + 路由 + 抽屉入口

**重要现状：** `FriendsPage.vue` 已有"点击行打开详情抽屉"（`handleRowClick → openDrawer`），抽屉承载全年分布/AI 分析/AI 建议/编辑。本任务**保留抽屉的行点击不变**，只在抽屉内加一个"查看完整图表"入口跳转到新页；新页只放三张新图。

**Files:**
- Create: `packages/web/src/pages/FriendDetail.vue`
- Modify: `packages/web/src/router/index.ts`
- Modify: `packages/web/src/pages/FriendsPage.vue`（抽屉内新增跳转入口，**不改 `handleRowClick`**）
- Test: `packages/web/src/pages/__tests__/FriendDetail.test.ts`
- Test: `packages/web/src/pages/__tests__/FriendsPage.test.ts`（追加抽屉入口用例 + 更新 `makeRouter` 路由表）

**Interfaces:**
- Consumes: `HourBars`/`WeekHourHeatmap`/`WordRanks`（Task 5–7）、`useDataStore().friends`。
- Produces: 路由 `{ path: '/friends/:id', name: 'friend-detail', component: FriendDetail }`；`FriendDetail` 按 `route.params.id` 取好友渲染三图，未命中显示空态。抽屉内有指向 `/friends/:id` 的 `RouterLink`。

- [ ] **Step 1: 写失败测试（FriendDetail）**

`packages/web/src/pages/__tests__/FriendDetail.test.ts`：
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import FriendDetail from '../FriendDetail.vue'
import { useDataStore } from '../../stores/data'
import { createFriend } from '@nianlun/core'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/friends/:id', name: 'friend-detail', component: FriendDetail }],
  })
}

describe('FriendDetail', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('按 id 渲染好友与三图', async () => {
    const data = useDataStore()
    const f = createFriend('周彤', '周彤'); f.msgCount = 100; f.hourly[9] = 5
    f.keywords = [{ word: '开会', count: 3 }]
    data.friends = [f]
    const router = makeRouter(); router.push('/friends/周彤'); await router.isReady()
    const w = mount(FriendDetail, { global: { plugins: [router] } })
    expect(w.text()).toContain('周彤')
    expect(w.findAll('[data-h]')).toHaveLength(24)        // HourBars
    expect(w.findAll('[data-cell]')).toHaveLength(168)    // 热力图
    expect(w.text()).toContain('开会')                     // 词频
  })

  it('未知 id 显示空态', async () => {
    useDataStore().friends = []
    const router = makeRouter(); router.push('/friends/none'); await router.isReady()
    const w = mount(FriendDetail, { global: { plugins: [router] } })
    expect(w.text()).toMatch(/没有|未找到|不存在/)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run src/pages/__tests__/FriendDetail.test.ts`
Expected: FAIL（找不到组件）

- [ ] **Step 3: 写 `FriendDetail.vue`**

`packages/web/src/pages/FriendDetail.vue`：
```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useDataStore } from '../stores/data'
import HourBars from '../components/charts/HourBars.vue'
import WeekHourHeatmap from '../components/charts/WeekHourHeatmap.vue'
import WordRanks from '../components/charts/WordRanks.vue'

const route = useRoute()
const data = useDataStore()
const friend = computed(() => data.friends.find((f) => f.id === route.params.id))
</script>

<template>
  <section v-if="friend" class="friend-detail">
    <header>
      <h1>{{ friend.name }}</h1>
      <p>{{ friend.rel }} · 共 {{ friend.msgCount }} 条消息</p>
    </header>
    <h2>时段分布</h2>
    <HourBars :hourly="friend.hourly" />
    <h2>周 × 时活跃热力</h2>
    <WeekHourHeatmap :week-hour="friend.weekHour" />
    <h2>高频词</h2>
    <WordRanks :keywords="friend.keywords" />
  </section>
  <section v-else class="empty">
    <p>未找到该好友，可能数据尚未导入。</p>
    <RouterLink to="/friends">返回好友列表</RouterLink>
  </section>
</template>
```

- [ ] **Step 4: 注册路由**

`packages/web/src/router/index.ts`：import 组件并加路由。
- 顶部加：`import FriendDetail from '../pages/FriendDetail.vue'`
- 在 `{ path: '/friends', ... }` 后加：`{ path: '/friends/:id', name: 'friend-detail', component: FriendDetail },`

- [ ] **Step 5: 运行 FriendDetail 测试确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run src/pages/__tests__/FriendDetail.test.ts`
Expected: PASS

- [ ] **Step 6: 写失败的 FriendsPage 抽屉入口测试**

更新 `packages/web/src/pages/__tests__/FriendsPage.test.ts` 的 `makeRouter`，把 `/friends/:id` 加进路由表：
```ts
function makeRouter() {
  return createRouter({ history: createMemoryHistory(), routes: [
    ...['/', '/import', '/friends', '/report'].map((p) => ({ path: p, component: { template: '<div/>' } })),
    { path: '/friends/:id', name: 'friend-detail', component: { template: '<div/>' } },
  ] })
}
```
并追加（点击行打开抽屉后，抽屉里应有指向 `/friends/<id>` 的链接）：
```ts
it('抽屉里有跳转到完整图表页的入口', async () => {
  const router = makeRouter(); router.push('/friends'); await router.isReady()
  seed()
  const wrapper = mount(FriendsPage, { global: { plugins: [router] } })
  await wrapper.find('tbody tr').trigger('click') // 打开抽屉
  const link = wrapper.find('.drawer a[href="/friends/周彤"]')
  expect(link.exists()).toBe(true)
})
```

- [ ] **Step 7: 运行测试确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run src/pages/__tests__/FriendsPage.test.ts`
Expected: FAIL（抽屉内无该链接）

- [ ] **Step 8: 在抽屉里加"查看完整图表"入口（不改 `handleRowClick`）**

`packages/web/src/pages/FriendsPage.vue`：在抽屉 `<div v-if="drawerFriend" class="drawer-body">` 内（例如紧接 `d-grid` 之后）插入一个 `RouterLink`：
```html
<RouterLink
  v-if="drawerFriend"
  class="btn btn-sm full-charts-link"
  :to="`/friends/${drawerFriend.id}`"
>查看完整图表 →</RouterLink>
```
`RouterLink` 是全局组件（已 `app.use(router)`），无需在该文件 import。行点击仍走 `handleRowClick`（打开抽屉），不改动。

- [ ] **Step 9: 运行测试确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run src/pages/__tests__/FriendsPage.test.ts src/pages/__tests__/FriendDetail.test.ts`
Expected: PASS

- [ ] **Step 10: 提交**

```bash
git add packages/web/src/pages/FriendDetail.vue packages/web/src/router/index.ts packages/web/src/pages/FriendsPage.vue packages/web/src/pages/__tests__/FriendDetail.test.ts packages/web/src/pages/__tests__/FriendsPage.test.ts
git commit -m "feat(web): add friend detail page with charts and drawer entry"
```

---

### Task 9: 报告页全局图表

**重要现状：** ReportPage 已有"年度关键词"区块渲染 `report.keywords`（`v-if="report.keywords.length"`，约 136–145 行）。Task 4 让 `buildReport` 填充 `keywords` 后，该区块会自动有内容——**全局词频复用此区块，本任务不再加 WordRanks**。本任务只新增两张图：时段柱状图 + 周×时热力图，放进海报 `<article class="poster">` 内。

**Files:**
- Modify: `packages/web/src/pages/ReportPage.vue`
- Test: `packages/web/src/pages/__tests__/ReportPage.test.ts`

**Interfaces:**
- Consumes: `sumHourly`/`sumWeekHour`（`@nianlun/core`，Task 4）、`HourBars`/`WeekHourHeatmap`、`useDataStore().friends`（本文件已有 `const data = useDataStore()`）。
- Produces: 海报内新增"时段/热力"两图区块，数据来自对 `data.friends` 的派生。全局词频继续由既有"年度关键词"区块渲染。

- [ ] **Step 1: 写失败测试**

在 `packages/web/src/pages/__tests__/ReportPage.test.ts` 追加用例（`makeRouter`/`createFriend` 已在该文件存在）：
```ts
it('渲染全局时段柱状图与周×时热力图，并展示年度关键词', async () => {
  const data = useDataStore()
  const f = createFriend('A', 'A'); f.msgCount = 10; f.hourly[9] = 4; f.weekHour[34] = 4
  data.friends = [f]
  data.report = { year: 2025, totalMessages: 10, friendCount: 1, activeDays: 1, topContacts: [], latestMessage: null, keywords: [{ word: '开会', count: 4 }], relationBreakdown: [] }
  const router = makeRouter(); router.push('/report'); await router.isReady()
  const w = mount(ReportPage, { global: { plugins: [router] } })
  expect(w.findAll('[data-h]')).toHaveLength(24)      // HourBars
  expect(w.findAll('[data-cell]')).toHaveLength(168)  // 热力图
  expect(w.text()).toContain('开会')                   // 既有年度关键词区块
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run src/pages/__tests__/ReportPage.test.ts`
Expected: FAIL（无 `[data-h]` / `[data-cell]` 节点）

- [ ] **Step 3: 给 ReportPage 接入两张图**

`packages/web/src/pages/ReportPage.vue` 的 `<script setup>`（已有 `import { computed } from 'vue'` 与 `const data = useDataStore()`）追加：
```ts
import { sumHourly, sumWeekHour } from '@nianlun/core'
import HourBars from '../components/charts/HourBars.vue'
import WeekHourHeatmap from '../components/charts/WeekHourHeatmap.vue'

const globalHourly = computed(() => sumHourly(data.friends))
const globalWeekHour = computed(() => sumWeekHour(data.friends))
```
模板里在 `<article class="poster" ...>` 内、"关系版图"区块（`v-if="report.relationBreakdown.length"`）之后、"closing"区块之前，插入一节（沿用海报既有 `p-sec`/`p-kicker` 样式；`report` 在 `v-else` 分支内必存在，直接用）：
```html
<section class="p-sec">
  <div class="p-kicker">一天里的活跃时段</div>
  <HourBars :hourly="globalHourly" />
</section>
<section class="p-sec">
  <div class="p-kicker">一周的活跃节律</div>
  <WeekHourHeatmap :week-hour="globalWeekHour" />
</section>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run src/pages/__tests__/ReportPage.test.ts`
Expected: PASS

- [ ] **Step 5: 全量 web 测试 + 类型构建**

Run: `pnpm --filter @nianlun/web test`，然后 `pnpm --filter @nianlun/web build`
Expected: 全绿；`vue-tsc --noEmit` 无类型错误；vite build 成功

- [ ] **Step 6: 提交**

```bash
git add packages/web/src/pages/ReportPage.vue packages/web/src/pages/__tests__/ReportPage.test.ts
git commit -m "feat(web): render global hour/week-hour/keyword charts on report page"
```

---

## 收尾校验

- [ ] **Step 1: 全仓库测试**

Run: `pnpm -r test`
Expected: core + web 全绿。

- [ ] **Step 2: 全仓库构建**

Run: `pnpm -r build`
Expected: 两包均构建成功（确认 core 改动未破坏 web 类型）。
