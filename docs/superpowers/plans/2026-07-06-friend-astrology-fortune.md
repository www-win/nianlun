# 好友命理运势分析 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在好友详情页新增「☯ 命理运势」卡：由生辰确定性排出八字/流月流日/合盘，交 AI 解读性格·运势·相性·社交提示，结果持久化（带跨天时效）。

**Architecture:** 沿用现有「好友画像」骨架（`core/ai/profile.ts` 组 prompt+容错解析 → 详情页渲染卡）。新增一层**确定性历法层** `core/astrology/*`（引 lunar-javascript 排盘，纯函数）；AI 只做自然语言解读，不算干支。miniapp 侧新增「我的命盘」设置页、好友生辰补录、解读缓存（存 wx storage，类比 `saveSamples`）。

**Tech Stack:** TypeScript（core 纯函数库，`lib:ES2020`/`types:[]`）、lunar-javascript（历法，core 首个运行时依赖）、tsup（core 打包，需 noExternal 把 lunar 打进 dist）、Vue3 + uni-app（miniapp）、Vitest。

## Global Constraints

以下为 spec 的项目级约束，每个任务都隐含遵守（值照抄 spec）：

- 注释/文案一律**中文**。
- `@nianlun/core` 是纯函数库：**不碰 DOM/window/网络/vue**；历法层必须纯确定性；解析器容错、**永不抛异常**，垃圾输入返回空结果。
- 依赖链严格 `miniapp → core`。**改 core 后必须 `pnpm --filter @nianlun/core build`**（用 PowerShell，避免中文变 `?`），miniapp 才能解析新 dist。
- AI 只做解读，**不让 AI 自己算干支**；prompt 内明确"盘已算好"。
- 任一字段无可靠依据填「暂无足够线索」，禁止臆测；社交结论措辞软化，定位"提醒"非"判决"。
- 发给 AI 的只有**算好的结构化盘 + 有界样本**，绝不发聊天原文；生辰只存本地。
- AI 解读结果**持久化**（存 storage，刷新即见）；带 `生成日期 + 生辰指纹 + 我的盘指纹`，跨天或指纹变则展示缓存+提示刷新，不自动清空/重算。
- 命盘速览是确定性结果，本地算、秒出，不经 AI。
- 命理内容**仅供娱乐参考**，卡底大免责。
- **Windows 上用 PowerShell 跑 build/test。**

**关键命令速查：**
- core 单测：`pnpm --filter @nianlun/core exec vitest run <文件路径>`
- core 打包：`pnpm --filter @nianlun/core build`
- miniapp 单测：`pnpm --filter @nianlun/miniapp exec vitest run <文件路径>`
- miniapp 小程序构建：`pnpm --filter @nianlun/miniapp build:mp-weixin`

---

### Task 1: core 集成 lunar-javascript（依赖 + 类型垫片 + 打包验证）

这是**风险最高**的任务：验证第三方历法库能进 `types:[]` 的 core 并被 tsup 打进 dist 供 miniapp 解析。先做，失败则整个功能需换算法。

**Files:**
- Modify: `packages/core/package.json`（加 dependency + 改 build script）
- Create: `packages/core/tsup.config.ts`
- Create: `packages/core/src/lunar-javascript.d.ts`（模块声明垫片，仿 `src/intl-segmenter.d.ts`）
- Create: `packages/core/src/astrology/__tests__/smoke-lunar.test.ts`（临时冒烟，验证通过后可保留）

**Interfaces:**
- Produces: 可在 core 内 `import { Solar } from 'lunar-javascript'`，且 `pnpm --filter @nianlun/core build` 产出的 dist 内联 lunar（miniapp 无需单独装 lunar）。

- [ ] **Step 1: 安装依赖**

Run（PowerShell）: `pnpm --filter @nianlun/core add lunar-javascript`
Expected: `package.json` 出现 `"dependencies": { "lunar-javascript": "^1.x" }`。

- [ ] **Step 2: 写模块声明垫片**

lunar-javascript 无完整 TS 类型；`types:[]` + Bundler 解析下需声明。仿照现有 `packages/core/src/intl-segmenter.d.ts` 的做法，创建 `packages/core/src/lunar-javascript.d.ts`：

```typescript
// lunar-javascript 无官方 TS 类型，这里只声明本项目用到的最小子集。
declare module 'lunar-javascript' {
  export interface Lunar {
    getEightChar(): EightChar
    getYearShengXiao(): string
    getDayInGanZhi(): string
  }
  export interface EightChar {
    getYear(): string
    getMonth(): string
    getDay(): string
    getTime(): string
  }
  export interface Solar {
    getLunar(): Lunar
    getXingZuo(): string
  }
  export const Solar: {
    fromYmd(year: number, month: number, day: number): Solar
    fromYmdHms(year: number, month: number, day: number, hour: number, minute: number, second: number): Solar
  }
  export const Lunar: {
    fromDate(date: Date): Lunar
  }
}
```

- [ ] **Step 3: 配 tsup，把 lunar 打进 dist**

现 build 是命令行 `tsup src/index.ts --format esm --dts`。改为读配置文件以设置 `noExternal`。创建 `packages/core/tsup.config.ts`：

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  // lunar-javascript 是 core 唯一运行时依赖；打进 dist，让 miniapp 只依赖 @nianlun/core，
  // 无需单独安装 lunar（小程序端依赖解析更简单）。
  noExternal: ['lunar-javascript'],
})
```

改 `packages/core/package.json` 的 build 脚本：

```json
"build": "tsup"
```

- [ ] **Step 4: 写冒烟测试**

创建 `packages/core/src/astrology/__tests__/smoke-lunar.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { Solar } from 'lunar-javascript'

describe('lunar-javascript 冒烟', () => {
  it('能排出八字四柱、生肖、星座、当日干支', () => {
    const solar = Solar.fromYmdHms(1990, 8, 15, 14, 0, 0)
    const lunar = solar.getLunar()
    const ec = lunar.getEightChar()
    // 四柱应为两字干支字符串
    expect(ec.getYear()).toHaveLength(2)
    expect(ec.getMonth()).toHaveLength(2)
    expect(ec.getDay()).toHaveLength(2)
    expect(ec.getTime()).toHaveLength(2)
    // 1990 为马年
    expect(lunar.getYearShengXiao()).toContain('马')
    // 8/15 为狮子座
    expect(solar.getXingZuo()).toContain('狮子')
    // 当日干支两字
    expect(lunar.getDayInGanZhi()).toHaveLength(2)
  })
})
```

- [ ] **Step 5: 跑冒烟测试**

Run: `pnpm --filter @nianlun/core exec vitest run src/astrology/__tests__/smoke-lunar.test.ts`
Expected: PASS。**若某 API 名报错**（如 `getXingZuo`/`getYearShengXiao`/`getDayInGanZhi` 不存在），用该库实际 API 修正本测试与 Step 2 垫片，并记下正确名字——后续 Task 2/3 的调用需同步用正确名。

- [ ] **Step 6: 验证打包内联 lunar**

Run（PowerShell）: `pnpm --filter @nianlun/core build`
Expected: 成功产出 `dist/index.js` 与 `dist/index.d.ts`，无 external 警告残留 lunar（noExternal 已内联）。

- [ ] **Step 7: 提交**

```bash
git add packages/core/package.json packages/core/tsup.config.ts packages/core/src/lunar-javascript.d.ts packages/core/src/astrology/__tests__/smoke-lunar.test.ts pnpm-lock.yaml
git commit -m "chore(core): 集成 lunar-javascript(历法引擎)并配 tsup 内联打包"
```

---

### Task 2: 历法类型 + 八字排盘 `buildBaziChart`

**Files:**
- Create: `packages/core/src/astrology/types.ts`
- Create: `packages/core/src/astrology/chart.ts`
- Create: `packages/core/src/astrology/__tests__/chart.test.ts`

**Interfaces:**
- Consumes: `import { Solar } from 'lunar-javascript'`（Task 1）。
- Produces:
  - 类型 `BirthInfo`、`BaziChart`、`DayFortune`、`Compatibility`（供后续所有任务）。
  - `buildBaziChart(birth: BirthInfo): BaziChart`。
  - 导出常量 `STEM_WUXING`、`BRANCH_WUXING`（Task 3/4 复用）。

- [ ] **Step 1: 写类型文件**

创建 `packages/core/src/astrology/types.ts`：

```typescript
/** 生辰(用户填 / AI 抽取后确认)。公历默认；isLunar 时按农历输入。 */
export interface BirthInfo {
  year: number
  month: number
  day: number
  hour?: number          // 时辰 0–23，可选；缺则八字无时柱，只出三柱
  isLunar?: boolean
  gender?: 'male' | 'female'
}

/** 确定性排盘结果。 */
export interface BaziChart {
  pillars: { year: string; month: string; day: string; hour?: string }  // 四柱干支(两字)
  dayMaster: string                       // 日主天干(日柱第一个字)
  fiveElements: Record<string, number>    // 五行分布：木火土金水计数
  zodiac: string                          // 生肖
  constellation: string                   // 西洋星座
}

/** 流月/流日：某日期的干支与它对本命日主的生克。 */
export interface DayFortune {
  ganzhi: string                          // 当日干支
  relation: string                        // 生/克/比/泄/耗/平
}

/** 合盘(我 × 好友)：机械判定的刑冲合害。 */
export interface Compatibility {
  harmonies: string[]                     // 六合/三合等相合
  clashes: string[]                       // 相冲/相刑/相害 —— "冲课"落在这里
}
```

- [ ] **Step 2: 写失败测试**

创建 `packages/core/src/astrology/__tests__/chart.test.ts`。断言用**确定的命理事实**（生肖年份、星座日期、结构），不写死我未验证的具体干支：

```typescript
import { describe, it, expect } from 'vitest'
import { buildBaziChart } from '../chart'

describe('buildBaziChart', () => {
  it('含时辰：四柱齐全、日主为日柱首字、生肖星座正确、五行合计为8', () => {
    const c = buildBaziChart({ year: 1990, month: 8, day: 15, hour: 14 })
    expect(c.pillars.year).toHaveLength(2)
    expect(c.pillars.hour).toHaveLength(2)
    expect(c.dayMaster).toBe(c.pillars.day.charAt(0))
    expect(c.zodiac).toContain('马')          // 1990 马年
    expect(c.constellation).toContain('狮子')  // 8/15 狮子座
    const sum = Object.values(c.fiveElements).reduce((a, b) => a + b, 0)
    expect(sum).toBe(8)                        // 四柱天干+地支共8字
    expect(Object.keys(c.fiveElements).sort()).toEqual(['土', '木', '水', '火', '金'].sort())
  })

  it('缺时辰：省略 hour 柱、只出三柱、五行合计为6', () => {
    const c = buildBaziChart({ year: 1990, month: 8, day: 15 })
    expect(c.pillars.hour).toBeUndefined()
    const sum = Object.values(c.fiveElements).reduce((a, b) => a + b, 0)
    expect(sum).toBe(6)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/astrology/__tests__/chart.test.ts`
Expected: FAIL（`buildBaziChart` 未定义 / 模块不存在）。

- [ ] **Step 4: 实现 chart.ts**

创建 `packages/core/src/astrology/chart.ts`：

```typescript
import { Solar } from 'lunar-javascript'
import type { BirthInfo, BaziChart } from './types'

/** 天干五行。 */
export const STEM_WUXING: Record<string, string> = {
  甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土',
  己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水',
}
/** 地支本气五行。 */
export const BRANCH_WUXING: Record<string, string> = {
  子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火',
  午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水',
}

/**
 * 由生辰确定性排八字盘。含时辰则出四柱，缺则只出三柱。
 * 纯函数：不 new Date()、不访问全局，仅依赖 lunar-javascript 计算。
 */
export function buildBaziChart(birth: BirthInfo): BaziChart {
  const { year, month, day, hour } = birth
  const solar = hour != null
    ? Solar.fromYmdHms(year, month, day, hour, 0, 0)
    : Solar.fromYmd(year, month, day)
  const lunar = solar.getLunar()
  const ec = lunar.getEightChar()

  const pillars: BaziChart['pillars'] = {
    year: ec.getYear(),
    month: ec.getMonth(),
    day: ec.getDay(),
  }
  if (hour != null) pillars.hour = ec.getTime()

  // 五行分布：四柱天干 + 地支本气逐字计数。
  const fiveElements: Record<string, number> = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 }
  for (const p of [pillars.year, pillars.month, pillars.day, pillars.hour]) {
    if (!p) continue
    const w1 = STEM_WUXING[p.charAt(0)]
    const w2 = BRANCH_WUXING[p.charAt(1)]
    if (w1) fiveElements[w1]++
    if (w2) fiveElements[w2]++
  }

  return {
    pillars,
    dayMaster: pillars.day.charAt(0),
    fiveElements,
    zodiac: lunar.getYearShengXiao(),
    constellation: solar.getXingZuo(),
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/astrology/__tests__/chart.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/astrology/types.ts packages/core/src/astrology/chart.ts packages/core/src/astrology/__tests__/chart.test.ts
git commit -m "feat(core): 八字排盘 buildBaziChart(四柱/五行/生肖/星座)"
```

---

### Task 3: 流月流日 `getDayFortune` + 五行生克

**Files:**
- Create: `packages/core/src/astrology/fortune.ts`
- Create: `packages/core/src/astrology/__tests__/fortune.test.ts`

**Interfaces:**
- Consumes: `Solar`（Task 1）、`STEM_WUXING`（Task 2 的 chart.ts）、`BaziChart`/`DayFortune`（Task 2 的 types.ts）。
- Produces:
  - `wuxingRelation(base: string, other: string): string`（返回 比/生/泄/克/耗/平；Task 4 复用）。
  - `getDayFortune(date: { year: number; month: number; day: number }, chart: BaziChart): DayFortune`。
  - 日期作为参数传入（**core 不 new Date()**，由调用方传"今天"）。

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/astrology/__tests__/fortune.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { wuxingRelation, getDayFortune } from '../fortune'
import { buildBaziChart } from '../chart'

describe('wuxingRelation（以 base 为我）', () => {
  it('同五行=比', () => expect(wuxingRelation('木', '木')).toBe('比'))
  it('生我=生（水生木）', () => expect(wuxingRelation('木', '水')).toBe('生'))
  it('我生=泄（木生火）', () => expect(wuxingRelation('木', '火')).toBe('泄'))
  it('克我=克（金克木）', () => expect(wuxingRelation('木', '金')).toBe('克'))
  it('我克=耗（木克土）', () => expect(wuxingRelation('木', '土')).toBe('耗'))
})

describe('getDayFortune', () => {
  it('返回当日两字干支与一个生克关系', () => {
    const chart = buildBaziChart({ year: 1990, month: 8, day: 15, hour: 14 })
    const f = getDayFortune({ year: 2026, month: 7, day: 6 }, chart)
    expect(f.ganzhi).toHaveLength(2)
    expect(['比', '生', '泄', '克', '耗', '平']).toContain(f.relation)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/astrology/__tests__/fortune.test.ts`
Expected: FAIL（`wuxingRelation` 未定义）。

- [ ] **Step 3: 实现 fortune.ts**

创建 `packages/core/src/astrology/fortune.ts`：

```typescript
import { Solar } from 'lunar-javascript'
import { STEM_WUXING } from './chart'
import type { BaziChart, DayFortune } from './types'

// 五行相生：木→火→土→金→水→木
const SHENG: Record<string, string> = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' }
// 五行相克：木→土→水→火→金→木
const KE: Record<string, string> = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' }

/**
 * other 相对 base（我）的关系：
 * 比(同) / 生(other 生我) / 泄(我生 other) / 克(other 克我) / 耗(我克 other) / 平(未知)
 */
export function wuxingRelation(base: string, other: string): string {
  if (!base || !other) return '平'
  if (base === other) return '比'
  if (SHENG[other] === base) return '生'
  if (SHENG[base] === other) return '泄'
  if (KE[other] === base) return '克'
  if (KE[base] === other) return '耗'
  return '平'
}

/**
 * 某公历日期的当日干支，及其天干五行对本命日主的生克。
 * date 由调用方传入（core 不取系统时间，保证确定可测）。
 */
export function getDayFortune(
  date: { year: number; month: number; day: number },
  chart: BaziChart,
): DayFortune {
  const lunar = Solar.fromYmd(date.year, date.month, date.day).getLunar()
  const ganzhi = lunar.getDayInGanZhi()
  const dayGanWuxing = STEM_WUXING[ganzhi.charAt(0)]
  const baseWuxing = STEM_WUXING[chart.dayMaster]
  return { ganzhi, relation: wuxingRelation(baseWuxing, dayGanWuxing) }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/astrology/__tests__/fortune.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/astrology/fortune.ts packages/core/src/astrology/__tests__/fortune.test.ts
git commit -m "feat(core): 流月流日 getDayFortune 与五行生克 wuxingRelation"
```

---

### Task 4: 合盘 `getCompatibility`（地支冲合对照表）

**Files:**
- Create: `packages/core/src/astrology/compat.ts`
- Create: `packages/core/src/astrology/__tests__/compat.test.ts`

**Interfaces:**
- Consumes: `STEM_WUXING`（chart.ts）、`wuxingRelation`（fortune.ts）、`BaziChart`/`Compatibility`（types.ts）。
- Produces:
  - `isBranchClash(a: string, b: string): boolean`、`isBranchHarmony(a: string, b: string): boolean`（纯查表，供测试直接验证）。
  - `getCompatibility(a: BaziChart, b: BaziChart): Compatibility`。

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/astrology/__tests__/compat.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { isBranchClash, isBranchHarmony, getCompatibility } from '../compat'
import { buildBaziChart } from '../chart'

describe('地支冲合对照表', () => {
  it('子午相冲、无关顺序', () => {
    expect(isBranchClash('子', '午')).toBe(true)
    expect(isBranchClash('午', '子')).toBe(true)
    expect(isBranchClash('子', '丑')).toBe(false)
  })
  it('子丑六合、寅亥六合', () => {
    expect(isBranchHarmony('子', '丑')).toBe(true)
    expect(isBranchHarmony('寅', '亥')).toBe(true)
    expect(isBranchHarmony('子', '午')).toBe(false)
  })
})

describe('getCompatibility', () => {
  it('鼠年(1984) × 马年(1990)：年支子午相冲 → clashes 非空', () => {
    const a = buildBaziChart({ year: 1984, month: 6, day: 1 })  // 子(鼠)
    const b = buildBaziChart({ year: 1990, month: 6, day: 1 })  // 午(马)
    const c = getCompatibility(a, b)
    expect(c.clashes.length).toBeGreaterThan(0)
  })
  it('返回结构含 harmonies / clashes 数组', () => {
    const a = buildBaziChart({ year: 1990, month: 6, day: 1 })
    const c = getCompatibility(a, a)
    expect(Array.isArray(c.harmonies)).toBe(true)
    expect(Array.isArray(c.clashes)).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/astrology/__tests__/compat.test.ts`
Expected: FAIL（`isBranchClash` 未定义）。

- [ ] **Step 3: 实现 compat.ts**

创建 `packages/core/src/astrology/compat.ts`：

```typescript
import { STEM_WUXING } from './chart'
import { wuxingRelation } from './fortune'
import type { BaziChart, Compatibility } from './types'

// 地支六冲
const CLASH: Array<[string, string]> = [
  ['子', '午'], ['丑', '未'], ['寅', '申'], ['卯', '酉'], ['辰', '戌'], ['巳', '亥'],
]
// 地支六合
const SIX_HARMONY: Array<[string, string]> = [
  ['子', '丑'], ['寅', '亥'], ['卯', '戌'], ['辰', '酉'], ['巳', '申'], ['午', '未'],
]

function inPairs(pairs: Array<[string, string]>, a: string, b: string): boolean {
  return pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
}
export function isBranchClash(a: string, b: string): boolean { return inPairs(CLASH, a, b) }
export function isBranchHarmony(a: string, b: string): boolean { return inPairs(SIX_HARMONY, a, b) }

/** 年柱地支（即生肖对应的支）。 */
function yearBranch(chart: BaziChart): string { return chart.pillars.year.charAt(1) }

/**
 * 合盘（a=我，b=好友）：以年支（生肖）判六合/相冲，附日主五行生克描述。
 * 纯机械判定，不涉 AI。
 */
export function getCompatibility(a: BaziChart, b: BaziChart): Compatibility {
  const harmonies: string[] = []
  const clashes: string[] = []
  const ba = yearBranch(a)
  const bb = yearBranch(b)

  if (isBranchClash(ba, bb)) clashes.push(`生肖相冲（${a.zodiac} ↔ ${b.zodiac}）`)
  if (isBranchHarmony(ba, bb)) harmonies.push(`生肖六合（${a.zodiac} ↔ ${b.zodiac}）`)

  // 日主五行生克：对方日主相对我的关系
  const rel = wuxingRelation(STEM_WUXING[a.dayMaster], STEM_WUXING[b.dayMaster])
  if (rel === '生') harmonies.push('对方日主生我，相处得助')
  else if (rel === '克') clashes.push('对方日主克我，易受牵制')

  return { harmonies, clashes }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/astrology/__tests__/compat.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/astrology/compat.ts packages/core/src/astrology/__tests__/compat.test.ts
git commit -m "feat(core): 合盘 getCompatibility(生肖冲合+日主生克)"
```

---

### Task 5: AI 层 `astro.ts`（解读 + 抽生辰）

仿 `core/ai/profile.ts` 模式（组 prompt / 容错解析 / pickText）。

**Files:**
- Create: `packages/core/src/ai/astro.ts`
- Create: `packages/core/src/ai/__tests__/astro.test.ts`

**Interfaces:**
- Consumes: `Friend`（model/types）、`BaziChart`/`DayFortune`/`Compatibility`/`BirthInfo`（astrology/types）。
- Produces:
  - 类型 `AstroReading { personality?; fortune?; affinity?; advice? }`。
  - `buildAstroPrompt(friend, chart, dayFortune, compat): string`
  - `parseAstroReading(text: string): AstroReading`
  - `buildBirthExtractPrompt(friend, samples): string`
  - `parseBirthInfo(text: string): BirthInfo | null`

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/ai/__tests__/astro.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import type { Friend } from '../../model/types'
import type { BaziChart, DayFortune, Compatibility } from '../../astrology/types'
import {
  buildAstroPrompt, parseAstroReading, buildBirthExtractPrompt, parseBirthInfo,
} from '../astro'

const friend: Friend = {
  id: 'f1', name: '小美', alias: '', rel: '客户', role: '支行长',
  firstContact: 0, lastContact: 0, msgCount: 300, sentRatio: 55,
  peakPeriod: '晚上', maxStreak: 9, monthly: new Array(12).fill(0), userEdited: {},
  hourly: new Array(24).fill(0), weekHour: new Array(168).fill(0), keywords: [],
}
const chart: BaziChart = {
  pillars: { year: '庚午', month: '甲申', day: '丙子', hour: '乙未' },
  dayMaster: '丙', fiveElements: { 木: 2, 火: 2, 土: 1, 金: 2, 水: 1 },
  zodiac: '马', constellation: '狮子',
}
const fortune: DayFortune = { ganzhi: '戊寅', relation: '泄' }
const compat: Compatibility = { harmonies: ['生肖六合（鼠 ↔ 牛）'], clashes: [] }

describe('buildAstroPrompt', () => {
  it('含好友名、盘数据、四段字段、免责/软化约束、"盘已算好"', () => {
    const p = buildAstroPrompt(friend, chart, fortune, compat)
    expect(p).toContain('小美')
    expect(p).toContain('丙子')            // 盘数据
    expect(p).toContain('戊寅')            // 流日
    expect(p).toContain('personality')
    expect(p).toContain('fortune')
    expect(p).toContain('affinity')
    expect(p).toContain('advice')
    expect(p).toContain('暂无足够线索')
    expect(p).toContain('已算好')          // 明确不让 AI 自己算
    expect(p).toContain('娱乐')            // 免责/软化
  })
  it('compat 为 null 也不抛', () => {
    expect(() => buildAstroPrompt(friend, chart, fortune, null)).not.toThrow()
  })
})

describe('parseAstroReading', () => {
  it('解析完整对象', () => {
    const r = parseAstroReading(JSON.stringify({
      personality: '性子急', fortune: '近期平稳', affinity: '与你相合', advice: '可正常往来',
    }))
    expect(r.personality).toBe('性子急')
    expect(r.advice).toBe('可正常往来')
  })
  it('剥围栏、缺字段省略、空串过滤', () => {
    expect(parseAstroReading('```json\n{"fortune":"顺"}\n```').fortune).toBe('顺')
    expect(parseAstroReading('{"personality":"  "}').personality).toBeUndefined()
  })
  it('垃圾输入返回 {}，不抛', () => {
    expect(parseAstroReading('不是 JSON')).toEqual({})
    expect(parseAstroReading('')).toEqual({})
  })
})

describe('buildBirthExtractPrompt / parseBirthInfo', () => {
  it('prompt 含好友名与样本、要求 JSON 生辰、无线索留空', () => {
    const p = buildBirthExtractPrompt(friend, ['我：你几号生日', '对方：我1990年8月15号的'])
    expect(p).toContain('小美')
    expect(p).toContain('1990年8月15号')
    expect(p).toContain('year')
    expect(p).toContain('未找到')
  })
  it('解析有效生辰', () => {
    const b = parseBirthInfo(JSON.stringify({ year: 1990, month: 8, day: 15, hour: 14, gender: 'female' }))
    expect(b).toEqual({ year: 1990, month: 8, day: 15, hour: 14, gender: 'female' })
  })
  it('缺年月日/超范围/垃圾输入返回 null', () => {
    expect(parseBirthInfo(JSON.stringify({ year: 1990, month: 8 }))).toBeNull()
    expect(parseBirthInfo(JSON.stringify({ year: 1990, month: 13, day: 1 }))).toBeNull()
    expect(parseBirthInfo('不是 JSON')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/astro.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 astro.ts**

创建 `packages/core/src/ai/astro.ts`：

```typescript
import type { Friend } from '../model/types'
import type { BaziChart, DayFortune, Compatibility, BirthInfo } from '../astrology/types'

export interface AstroReading {
  personality?: string   // 性格解读(并入 MBTI 味道)
  fortune?: string       // 近期流月流日运势解读
  affinity?: string      // 与我的相性("运势是否对称")
  advice?: string        // 社交结论(措辞软化)
}

/** 取非空 trim 字符串，否则 undefined。 */
function pickText(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

/**
 * 命理解读提示词：把「已算好的」结构化盘 + 流日 + 合盘交给 AI，只做自然语言解读。
 * 明确禁止 AI 自己推算干支；无线索填「暂无足够线索」；社交建议软化、娱乐向。
 */
export function buildAstroPrompt(
  friend: Friend, chart: BaziChart, dayFortune: DayFortune, compat: Compatibility | null,
): string {
  const displayName = friend.alias || friend.name
  const pillars = [chart.pillars.year, chart.pillars.month, chart.pillars.day, chart.pillars.hour]
    .filter(Boolean).join(' ')
  const wuxing = Object.entries(chart.fiveElements).map(([k, v]) => `${k}${v}`).join(' ')
  const compatLine = compat
    ? `与我合盘：相合[${compat.harmonies.join('、') || '无'}]，相冲[${compat.clashes.join('、') || '无'}]`
    : '与我合盘：我的命盘未设置，暂不评相性'

  return [
    '你是一位擅长把命盘转成通俗解读的观察者。以下命盘、流日、合盘均「已算好」，',
    '你只需据此做自然语言解读，切勿自行推算干支或改动盘面数据。',
    '',
    '只输出一个严格的 JSON 对象，不要任何解释、不要代码围栏外的文字。格式：',
    '{',
    '  "personality": "<性格解读：结合日主与五行，一小段>",',
    '  "fortune": "<近期运势：结合流月流日干支与生克，一小段>",',
    '  "affinity": "<与我的相性：结合合盘相合/相冲，一小段>",',
    '  "advice": "<社交提示：近期宜亲近或宜保持距离，附一句依据>"',
    '}',
    '',
    '要求：每段约 30~60 字。任一字段无可靠依据填「暂无足够线索」，禁止臆测。',
    '这是仅供娱乐参考的命理解读；advice 措辞要温和，是「提个醒」而非结论，避免劝人绝交。',
    '',
    '盘面数据：',
    `- 好友：${displayName}（关系：${friend.rel}${friend.role ? '，' + friend.role : ''}）`,
    `- 四柱：${pillars}`,
    `- 日主：${chart.dayMaster}；五行分布：${wuxing}`,
    `- 生肖：${chart.zodiac}；星座：${chart.constellation}`,
    `- 当前流日：${dayFortune.ganzhi}（对其本命日主为「${dayFortune.relation}」）`,
    `- ${compatLine}`,
  ].join('\n')
}

/** 容错解析命理解读 JSON：剥围栏、定位花括号、逐字段取非空串；垃圾输入返回 {}，永不抛异常。 */
export function parseAstroReading(text: string): AstroReading {
  if (typeof text !== 'string') return {}
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return {}
  let obj: unknown
  try { obj = JSON.parse(text.slice(start, end + 1)) } catch { return {} }
  if (typeof obj !== 'object' || obj === null) return {}
  const r = obj as Record<string, unknown>
  const out: AstroReading = {}
  const personality = pickText(r.personality); if (personality) out.personality = personality
  const fortune = pickText(r.fortune); if (fortune) out.fortune = fortune
  const affinity = pickText(r.affinity); if (affinity) out.affinity = affinity
  const advice = pickText(r.advice); if (advice) out.advice = advice
  return out
}

/** 抽生辰提示词：从有界样本里找好友透露的出生信息；找不到留空，禁止编造。 */
export function buildBirthExtractPrompt(friend: Friend, samples: string[]): string {
  const displayName = friend.alias || friend.name
  const sampleBlock = samples.length
    ? samples.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '（本次无可用聊天样本）'
  return [
    `请从下面与「${displayName}」的聊天样本里，找出 TA 明确透露的出生信息（阳历优先）。`,
    '只输出一个严格 JSON 对象，不要围栏外文字：',
    '{ "year": <年>, "month": <月1-12>, "day": <日1-31>, "hour": <时0-23，可省>, "isLunar": <是否农历，可省>, "gender": <"male"|"female"，可省> }',
    '若样本中没有可靠的出生信息，输出 {"found": false}（表示「未找到」），禁止编造生辰。',
    '',
    '聊天样本（「我」为用户本人，「对方」为该好友）：',
    sampleBlock,
  ].join('\n')
}

function pickInt(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined
}

/** 容错解析生辰：年月日必须有效，否则 null；hour/gender/isLunar 可选。永不抛异常。 */
export function parseBirthInfo(text: string): BirthInfo | null {
  if (typeof text !== 'string') return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  let obj: unknown
  try { obj = JSON.parse(text.slice(start, end + 1)) } catch { return null }
  if (typeof obj !== 'object' || obj === null) return null
  const r = obj as Record<string, unknown>
  const year = pickInt(r.year, 1900, 2100)
  const month = pickInt(r.month, 1, 12)
  const day = pickInt(r.day, 1, 31)
  if (year === undefined || month === undefined || day === undefined) return null
  const out: BirthInfo = { year, month, day }
  const hour = pickInt(r.hour, 0, 23); if (hour !== undefined) out.hour = hour
  if (r.isLunar === true) out.isLunar = true
  if (r.gender === 'male' || r.gender === 'female') out.gender = r.gender
  return out
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/astro.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/ai/astro.ts packages/core/src/ai/__tests__/astro.test.ts
git commit -m "feat(core): AI 命理解读 astro.ts(解读+抽生辰,容错解析)"
```

---

### Task 6: core 导出 + 全量构建

**Files:**
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: 从 `@nianlun/core` 导出 `buildBaziChart`/`getDayFortune`/`getCompatibility`/`wuxingRelation`/`buildAstroPrompt`/`parseAstroReading`/`buildBirthExtractPrompt`/`parseBirthInfo` 及类型 `BirthInfo`/`BaziChart`/`DayFortune`/`Compatibility`/`AstroReading`。miniapp 后续任务据此 import。

- [ ] **Step 1: 追加导出**

在 `packages/core/src/index.ts` 末尾追加：

```typescript
export { buildBaziChart } from './astrology/chart'
export { getDayFortune, wuxingRelation } from './astrology/fortune'
export { getCompatibility, isBranchClash, isBranchHarmony } from './astrology/compat'
export type { BirthInfo, BaziChart, DayFortune, Compatibility } from './astrology/types'
export { buildAstroPrompt, parseAstroReading, buildBirthExtractPrompt, parseBirthInfo } from './ai/astro'
export type { AstroReading } from './ai/astro'
```

- [ ] **Step 2: 跑 core 全部测试**

Run: `pnpm --filter @nianlun/core exec vitest run`
Expected: 全绿（含新增 astrology/ai 测试与原有测试）。

- [ ] **Step 3: 构建 core（PowerShell）**

Run: `pnpm --filter @nianlun/core build`
Expected: 成功产出 `dist/index.js` + `dist/index.d.ts`，导出可见。**miniapp 后续任务依赖此 dist。**

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): 导出命理运势 API(排盘/流日/合盘/AI解读)"
```

---

### Task 7: miniapp 存储（我的命盘 / 好友生辰 / 解读缓存）

**Files:**
- Modify: `packages/miniapp/src/adapters/storage.ts`
- Modify: `packages/miniapp/src/adapters/__tests__/storage.test.ts`

**Interfaces:**
- Consumes: `BirthInfo`/`BaziChart`/`AstroReading`（`@nianlun/core`，Task 6 已导出并 build）。
- Produces（挂在 `makeStorage` 返回对象上）：
  - `saveMyBazi(b: BirthInfo): void` / `loadMyBazi(): BirthInfo | null`
  - `saveBirths(m: Record<string, BirthInfo>): void` / `loadBirths(): Record<string, BirthInfo>`
  - `saveAstroReading(map: Record<string, StoredAstroReading>): void` / `loadAstroReading(): Record<string, StoredAstroReading>`
  - 导出接口 `StoredAstroReading`
  - 三者纳入 `clearAll`。

- [ ] **Step 1: 写失败测试**

在 `packages/miniapp/src/adapters/__tests__/storage.test.ts` 顶部 import 处补类型，并在末尾 `describe` 内追加：

```typescript
import type { BirthInfo } from '@nianlun/core'

describe('命理存储', () => {
  const BIRTH: BirthInfo = { year: 1990, month: 8, day: 15, hour: 14 }

  it('saveMyBazi/loadMyBazi 往返，缺失返回 null', () => {
    const s = makeStorage(memBackend())
    expect(s.loadMyBazi()).toBeNull()
    s.saveMyBazi(BIRTH)
    expect(s.loadMyBazi()).toEqual(BIRTH)
  })

  it('saveBirths/loadBirths 往返，缺失返回空对象', () => {
    const s = makeStorage(memBackend())
    expect(s.loadBirths()).toEqual({})
    s.saveBirths({ f1: BIRTH })
    expect(s.loadBirths().f1).toEqual(BIRTH)
  })

  it('saveAstroReading/loadAstroReading 往返，缺失返回空对象', () => {
    const s = makeStorage(memBackend())
    expect(s.loadAstroReading()).toEqual({})
    s.saveAstroReading({
      f1: {
        reading: { personality: '稳' },
        chart: { pillars: { year: '庚午', month: '甲申', day: '丙子' }, dayMaster: '丙', fiveElements: {}, zodiac: '马', constellation: '狮子' },
        generatedDate: '2026-07-06', birthFingerprint: 'x', myBaziFingerprint: 'y',
      },
    })
    expect(s.loadAstroReading().f1.generatedDate).toBe('2026-07-06')
    expect(s.loadAstroReading().f1.reading.personality).toBe('稳')
  })

  it('缺键返回空字符串时安全兜底（模拟真机）', () => {
    const wxLike = { get: (_k: string) => '', set: () => {}, remove: () => {} }
    const s = makeStorage(wxLike)
    expect(s.loadMyBazi()).toBeNull()
    expect(s.loadBirths()).toEqual({})
    expect(s.loadAstroReading()).toEqual({})
  })

  it('clearAll 清除命理三键', () => {
    const s = makeStorage(memBackend())
    s.saveMyBazi(BIRTH); s.saveBirths({ f1: BIRTH })
    s.saveAstroReading({ f1: { reading: {}, chart: {} as any, generatedDate: 'd', birthFingerprint: 'x', myBaziFingerprint: 'y' } })
    s.clearAll()
    expect(s.loadMyBazi()).toBeNull()
    expect(s.loadBirths()).toEqual({})
    expect(s.loadAstroReading()).toEqual({})
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts`
Expected: FAIL（`loadMyBazi` 不存在）。

- [ ] **Step 3: 实现存储**

在 `packages/miniapp/src/adapters/storage.ts`：

顶部 import 与键常量区补充：

```typescript
import type { Friend, ReportData, BirthInfo, BaziChart, AstroReading } from '@nianlun/core'
```

```typescript
const K_MY_BAZI = 'nianlun:myBazi'
const K_BIRTHS = 'nianlun:births'
const K_ASTRO = 'nianlun:astro'

/** 持久化的命理解读缓存（含时效元数据）。 */
export interface StoredAstroReading {
  reading: AstroReading
  chart: BaziChart              // 命盘速览，随解读一起缓存
  generatedDate: string         // 'YYYY-MM-DD'
  birthFingerprint: string      // 好友生辰指纹
  myBaziFingerprint: string     // 我的盘指纹
}
```

在 `makeStorage` 返回对象里（与 `saveSamples` 同级）追加方法：

```typescript
    saveMyBazi(b: BirthInfo): void { backend.set(K_MY_BAZI, b) },
    loadMyBazi(): BirthInfo | null {
      const raw = backend.get(K_MY_BAZI)
      return raw && typeof raw === 'object' ? (raw as BirthInfo) : null
    },
    saveBirths(m: Record<string, BirthInfo>): void { backend.set(K_BIRTHS, m) },
    loadBirths(): Record<string, BirthInfo> {
      const raw = backend.get(K_BIRTHS)
      return raw && typeof raw === 'object' ? (raw as Record<string, BirthInfo>) : {}
    },
    saveAstroReading(map: Record<string, StoredAstroReading>): void { backend.set(K_ASTRO, map) },
    loadAstroReading(): Record<string, StoredAstroReading> {
      const raw = backend.get(K_ASTRO)
      return raw && typeof raw === 'object' ? (raw as Record<string, StoredAstroReading>) : {}
    },
```

在 `clearAll` 内追加清除：

```typescript
      backend.remove(K_MY_BAZI); backend.remove(K_BIRTHS); backend.remove(K_ASTRO)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts`
Expected: PASS（含原有存储用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/storage.ts packages/miniapp/src/adapters/__tests__/storage.test.ts
git commit -m "feat(miniapp): 命理存储(我的命盘/好友生辰/解读缓存)"
```

---

### Task 8: miniapp `astroView` 组装层（指纹 / 过期 / 装配）

把「页面通过 lib 调 core」的分层落地：页面不直接 import core 历法函数，改调 `astroView`。指纹与过期判定为纯逻辑，可单测。

**Files:**
- Create: `packages/miniapp/src/lib/astroView.ts`
- Create: `packages/miniapp/src/lib/__tests__/astroView.test.ts`

**Interfaces:**
- Consumes: `buildBaziChart`/`getDayFortune`/`getCompatibility` + 类型（`@nianlun/core`）。
- Produces:
  - `birthFingerprint(b: BirthInfo | null | undefined): string`
  - `assembleAstro(friendBirth: BirthInfo, myBirth: BirthInfo | null, today: {year;month;day}): AstroAssembly`（`AstroAssembly { friendChart; myChart; fortune; compat }`）
  - `astroExpired(storedDate, storedFp, storedMyFp, todayStr, curFp, curMyFp): boolean`

- [ ] **Step 1: 写失败测试**

创建 `packages/miniapp/src/lib/__tests__/astroView.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { birthFingerprint, assembleAstro, astroExpired } from '../astroView'
import type { BirthInfo } from '@nianlun/core'

const BIRTH: BirthInfo = { year: 1990, month: 8, day: 15, hour: 14 }

describe('birthFingerprint', () => {
  it('相同生辰指纹一致，不同则不同，空为空串', () => {
    expect(birthFingerprint(BIRTH)).toBe(birthFingerprint({ ...BIRTH }))
    expect(birthFingerprint(BIRTH)).not.toBe(birthFingerprint({ ...BIRTH, day: 16 }))
    expect(birthFingerprint(null)).toBe('')
  })
})

describe('assembleAstro', () => {
  it('装配好友盘+流日；有我方生辰则出 myChart 与 compat', () => {
    const a = assembleAstro(BIRTH, { year: 1984, month: 6, day: 1 }, { year: 2026, month: 7, day: 6 })
    expect(a.friendChart.zodiac).toContain('马')
    expect(a.fortune.ganzhi).toHaveLength(2)
    expect(a.myChart).not.toBeNull()
    expect(a.compat).not.toBeNull()
  })
  it('无我方生辰则 myChart/compat 为 null', () => {
    const a = assembleAstro(BIRTH, null, { year: 2026, month: 7, day: 6 })
    expect(a.myChart).toBeNull()
    expect(a.compat).toBeNull()
  })
})

describe('astroExpired', () => {
  it('同日期同指纹=未过期', () => {
    expect(astroExpired('2026-07-06', 'a', 'b', '2026-07-06', 'a', 'b')).toBe(false)
  })
  it('跨天=过期', () => {
    expect(astroExpired('2026-07-05', 'a', 'b', '2026-07-06', 'a', 'b')).toBe(true)
  })
  it('生辰或我的盘指纹变=过期', () => {
    expect(astroExpired('2026-07-06', 'a', 'b', '2026-07-06', 'z', 'b')).toBe(true)
    expect(astroExpired('2026-07-06', 'a', 'b', '2026-07-06', 'a', 'z')).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/astroView.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 astroView.ts**

创建 `packages/miniapp/src/lib/astroView.ts`：

```typescript
import { buildBaziChart, getDayFortune, getCompatibility } from '@nianlun/core'
import type { BirthInfo, BaziChart, DayFortune, Compatibility } from '@nianlun/core'

export interface AstroAssembly {
  friendChart: BaziChart
  myChart: BaziChart | null
  fortune: DayFortune
  compat: Compatibility | null
}

/** 生辰指纹：字段变化即变化；空生辰为空串。 */
export function birthFingerprint(b: BirthInfo | null | undefined): string {
  if (!b) return ''
  return JSON.stringify([b.year, b.month, b.day, b.hour ?? null, b.isLunar ?? false, b.gender ?? ''])
}

/** 装配好友盘 + 流日；有我方生辰则一并出我方盘与合盘。today 由页面传入（不在此取系统时间）。 */
export function assembleAstro(
  friendBirth: BirthInfo,
  myBirth: BirthInfo | null,
  today: { year: number; month: number; day: number },
): AstroAssembly {
  const friendChart = buildBaziChart(friendBirth)
  const myChart = myBirth ? buildBaziChart(myBirth) : null
  const fortune = getDayFortune(today, friendChart)
  const compat = myChart ? getCompatibility(myChart, friendChart) : null
  return { friendChart, myChart, fortune, compat }
}

/** 缓存是否过期：跨天或任一指纹变更即过期。 */
export function astroExpired(
  storedDate: string, storedFp: string, storedMyFp: string,
  todayStr: string, curFp: string, curMyFp: string,
): boolean {
  return storedDate !== todayStr || storedFp !== curFp || storedMyFp !== curMyFp
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/astroView.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/lib/astroView.ts packages/miniapp/src/lib/__tests__/astroView.test.ts
git commit -m "feat(miniapp): astroView 组装层(指纹/过期/装配盘)"
```

---

### Task 9: miniapp `aiClient` 命理方法

**Files:**
- Modify: `packages/miniapp/src/adapters/aiClient.ts`
- Modify: `packages/miniapp/src/adapters/__tests__/aiClient.test.ts`

**Interfaces:**
- Consumes: `buildAstroPrompt`/`parseAstroReading`/`buildBirthExtractPrompt`/`parseBirthInfo` + 类型（`@nianlun/core`）；`astroView` 产出的 `chart/fortune/compat`。
- Produces（挂在 `makeAiClient` 返回对象上）：
  - `analyzeAstro(friend, chart, fortune, compat): Promise<AstroReading>`
  - `extractBirth(friend, samples): Promise<BirthInfo | null>`

- [ ] **Step 1: 写失败测试**

在 `packages/miniapp/src/adapters/__tests__/aiClient.test.ts` 追加（沿用该文件既有的 mock transport 写法；下面自带一个）：

```typescript
import { describe, it, expect } from 'vitest'
import { makeAiClient } from '../aiClient'
import type { BaziChart, DayFortune, Compatibility, Friend } from '@nianlun/core'

const friend = { id: 'f1', name: '小美', alias: '', rel: '客户', role: '' } as unknown as Friend
const chart: BaziChart = {
  pillars: { year: '庚午', month: '甲申', day: '丙子', hour: '乙未' },
  dayMaster: '丙', fiveElements: { 木: 2, 火: 2, 土: 1, 金: 2, 水: 1 }, zodiac: '马', constellation: '狮子',
}
const fortune: DayFortune = { ganzhi: '戊寅', relation: '泄' }
const compat: Compatibility = { harmonies: [], clashes: ['生肖相冲（鼠 ↔ 马）'] }

describe('aiClient 命理', () => {
  it('analyzeAstro：prompt 含盘数据，解析出四段', async () => {
    let seen = ''
    const client = makeAiClient(async (prompt) => {
      seen = prompt
      return JSON.stringify({ personality: '稳', fortune: '顺', affinity: '合', advice: '可正常往来' })
    })
    const r = await client.analyzeAstro(friend, chart, fortune, compat)
    expect(seen).toContain('丙子')
    expect(r.personality).toBe('稳')
    expect(r.advice).toBe('可正常往来')
  })

  it('extractBirth：解析出生辰；无则 null', async () => {
    const ok = makeAiClient(async () => JSON.stringify({ year: 1990, month: 8, day: 15 }))
    expect(await ok.extractBirth(friend, ['对方：我1990年8月15号'])).toEqual({ year: 1990, month: 8, day: 15 })
    const none = makeAiClient(async () => JSON.stringify({ found: false }))
    expect(await none.extractBirth(friend, [])).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/aiClient.test.ts`
Expected: FAIL（`analyzeAstro` 不存在）。

- [ ] **Step 3: 实现 aiClient 方法**

在 `packages/miniapp/src/adapters/aiClient.ts`：

顶部 import 追加：

```typescript
import {
  buildAstroPrompt, parseAstroReading, buildBirthExtractPrompt, parseBirthInfo,
} from '@nianlun/core'
import type { BaziChart, DayFortune, Compatibility, AstroReading, BirthInfo } from '@nianlun/core'
```

在 `makeAiClient` 返回对象里追加两个方法：

```typescript
    async analyzeAstro(
      friend: Friend, chart: BaziChart, fortune: DayFortune, compat: Compatibility | null,
    ): Promise<AstroReading> {
      const text = await transport(buildAstroPrompt(friend, chart, fortune, compat), 1024)
      return parseAstroReading(text)
    },
    async extractBirth(friend: Friend, samples: string[]): Promise<BirthInfo | null> {
      const text = await transport(buildBirthExtractPrompt(friend, samples), 256)
      return parseBirthInfo(text)
    },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/aiClient.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/aiClient.ts packages/miniapp/src/adapters/__tests__/aiClient.test.ts
git commit -m "feat(miniapp): aiClient 命理解读 analyzeAstro 与抽生辰 extractBirth"
```

---

### Task 10: 「我的命盘」设置页

新页面。uni-app 页面无单测，deliverable = 注册路由 + `build:mp-weixin` 通过 + 手测清单。

**Files:**
- Modify: `packages/miniapp/src/pages.json`（注册页面；tabBar 已满 5 项，故仅进 pages 不进 tabBar）
- Create: `packages/miniapp/src/pages/my-bazi/my-bazi.vue`

**Interfaces:**
- Consumes: `storage.saveMyBazi`/`loadMyBazi`（Task 7）、`BirthInfo`（core）。
- Produces: 页面路径 `pages/my-bazi/my-bazi`，供 friend-detail「未设置」态跳转。

- [ ] **Step 1: 注册路由**

在 `packages/miniapp/src/pages.json` 的 `pages` 数组追加一项（放在 friend-detail 之后）：

```json
    { "path": "pages/my-bazi/my-bazi", "style": { "navigationBarTitleText": "我的命盘" } }
```

- [ ] **Step 2: 实现设置页**

创建 `packages/miniapp/src/pages/my-bazi/my-bazi.vue`：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { BirthInfo } from '@nianlun/core'
import { storage } from '../../adapters/storage'

const year = ref('')
const month = ref('')
const day = ref('')
const hour = ref('')          // 空表示不填时辰
const isLunar = ref(false)
const gender = ref<'male' | 'female' | ''>('')

onLoad(() => {
  const b = storage.loadMyBazi()
  if (b) {
    year.value = String(b.year); month.value = String(b.month); day.value = String(b.day)
    hour.value = b.hour != null ? String(b.hour) : ''
    isLunar.value = !!b.isLunar
    gender.value = b.gender ?? ''
  }
})

function save() {
  const y = Number(year.value), m = Number(month.value), d = Number(day.value)
  if (!Number.isInteger(y) || y < 1900 || y > 2100 || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) {
    uni.showToast({ title: '请填写有效的年月日', icon: 'none' }); return
  }
  const b: BirthInfo = { year: y, month: m, day: d }
  if (hour.value !== '') {
    const h = Number(hour.value)
    if (h >= 0 && h <= 23) b.hour = h
  }
  if (isLunar.value) b.isLunar = true
  if (gender.value) b.gender = gender.value
  storage.saveMyBazi(b)
  uni.showToast({ title: '已保存', icon: 'success' })
  setTimeout(() => uni.navigateBack(), 500)
}
</script>

<template>
  <view class="page">
    <view class="card">
      <text class="title">设置我的生辰</text>
      <text class="hint">用于与好友合盘、判断流日相冲。仅存本机，不上传。</text>
      <view class="row"><text class="lbl">出生年</text><input class="inp" type="number" v-model="year" placeholder="如 1990" /></view>
      <view class="row"><text class="lbl">月</text><input class="inp" type="number" v-model="month" placeholder="1-12" /></view>
      <view class="row"><text class="lbl">日</text><input class="inp" type="number" v-model="day" placeholder="1-31" /></view>
      <view class="row"><text class="lbl">时辰(选填)</text><input class="inp" type="number" v-model="hour" placeholder="0-23，不确定可留空" /></view>
      <view class="row"><text class="lbl">按农历</text><switch :checked="isLunar" @change="(e: any) => isLunar = e.detail.value" /></view>
      <view class="row">
        <text class="lbl">性别(选填)</text>
        <view class="seg">
          <text :class="['seg-i', gender === 'male' && 'on']" @click="gender = gender === 'male' ? '' : 'male'">男</text>
          <text :class="['seg-i', gender === 'female' && 'on']" @click="gender = gender === 'female' ? '' : 'female'">女</text>
        </view>
      </view>
      <view class="save" @click="save">保存</view>
    </view>
  </view>
</template>

<style scoped>
.page { padding: 32rpx 28rpx; }
.card { padding: 32rpx 36rpx; }
.title { display: block; font-size: 32rpx; font-weight: 700; color: var(--fg); }
.hint { display: block; margin: 12rpx 0 24rpx; font-size: 23rpx; color: var(--muted); line-height: 1.6; }
.row { display: flex; align-items: center; justify-content: space-between; padding: 18rpx 0; border-top: 1rpx solid var(--border); }
.lbl { font-size: 26rpx; color: var(--muted); }
.inp { flex: 1; margin-left: 24rpx; height: 64rpx; padding: 0 20rpx; font-size: 26rpx; color: var(--fg); background: var(--surface); border: 1rpx solid var(--border-2); border-radius: 12rpx; text-align: right; }
.seg { display: flex; gap: 12rpx; }
.seg-i { padding: 10rpx 28rpx; font-size: 24rpx; border-radius: 999rpx; background: var(--surface-2); color: var(--muted); }
.seg-i.on { background: var(--accent); color: #fff; }
.save { margin-top: 32rpx; height: 80rpx; display: flex; align-items: center; justify-content: center; border-radius: 16rpx; background: var(--accent); color: #fff; font-size: 28rpx; font-weight: 600; }
</style>
```

- [ ] **Step 3: 构建小程序（PowerShell）**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 构建成功，无类型/编译错误。

- [ ] **Step 4: 手测清单（微信开发者工具打开 `dist/dev/mp-weixin`）**

- [ ] 用 `uni.navigateTo({ url: '/pages/my-bazi/my-bazi' })`（可临时从概览页触发，或下一任务的命理卡入口）能打开页面。
- [ ] 填 1990/8/15，保存 → toast「已保存」→ 返回。
- [ ] 再次进入，字段回填为已保存值。
- [ ] 年填 abc 或月填 13 → toast「请填写有效的年月日」，不保存。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/pages.json packages/miniapp/src/pages/my-bazi/my-bazi.vue
git commit -m "feat(miniapp): 我的命盘设置页(生辰录入,存本机)"
```

---

### Task 11: 好友详情页「☯ 命理运势」卡

在现有 `friend-detail.vue` 里新增按钮 + 卡片，覆盖三态（我的命盘未设置 / 好友生辰缺失 / 齐全）。仿现有 `analyzeProfile` 的 loading+渲染模式。页面无单测，deliverable = `build:mp-weixin` 通过 + 手测清单。

**Files:**
- Modify: `packages/miniapp/src/pages/friend-detail/friend-detail.vue`（`<script setup>` 加逻辑；`<template>` 加卡片；`<style>` 加样式）

**Interfaces:**
- Consumes: `storage`（loadMyBazi/loadBirths/saveBirths/loadAstroReading/saveAstroReading、`StoredAstroReading`）、`astroView`（birthFingerprint/assembleAstro/astroExpired）、`aiClient`（analyzeAstro/extractBirth）、`samples.loadSamplesFor`。

- [ ] **Step 1: `<script setup>` 追加逻辑**

在 `friend-detail.vue` 的 `<script setup>` 内，import 区追加：

```typescript
import { onShow } from '@dcloudio/uni-app'
import type { BirthInfo } from '@nianlun/core'
import { storage } from '../../adapters/storage'
import type { StoredAstroReading } from '../../adapters/storage'
import { birthFingerprint, assembleAstro, astroExpired } from '../../lib/astroView'
```

在末尾追加命理逻辑（`friend`、`aiClient`、`samples`、`id` 已在文件上文定义）：

```typescript
// —— 命理运势 —— //
const myBazi = ref<BirthInfo | null>(null)
const friendBirth = ref<BirthInfo | null>(null)
function reloadBirths() {
  myBazi.value = storage.loadMyBazi()
  friendBirth.value = friend.value ? storage.loadBirths()[friend.value.id] ?? null : null
}
onShow(reloadBirths)  // 从「我的命盘」设置页返回后刷新

const astro = ref<StoredAstroReading | null>(null)
const astroStale = ref(false)
const loadingAstro = ref(false)

function todayParts() {
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}
function todayStr(): string {
  const t = todayParts()
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`
}

// 载入缓存并判过期（不自动重算）
function loadAstroCache() {
  const f = friend.value
  if (!f) { astro.value = null; return }
  const cached = storage.loadAstroReading()[f.id] ?? null
  astro.value = cached
  if (cached) {
    astroStale.value = astroExpired(
      cached.generatedDate, cached.birthFingerprint, cached.myBaziFingerprint,
      todayStr(), birthFingerprint(friendBirth.value), birthFingerprint(myBazi.value),
    )
  } else {
    astroStale.value = false
  }
}
onLoad(() => { /* id 已在上文 onLoad 设置；此处延迟到 onShow 统一处理 */ })
onShow(() => { reloadBirths(); loadAstroCache() })

function goSetMyBazi() {
  uni.navigateTo({ url: '/pages/my-bazi/my-bazi' })
}

// 好友生辰补录表单
const showBirthForm = ref(false)
const bYear = ref(''); const bMonth = ref(''); const bDay = ref(''); const bHour = ref('')
function openBirthForm() {
  const b = friendBirth.value
  bYear.value = b ? String(b.year) : ''
  bMonth.value = b ? String(b.month) : ''
  bDay.value = b ? String(b.day) : ''
  bHour.value = b?.hour != null ? String(b.hour) : ''
  showBirthForm.value = true
}
function saveBirth() {
  const f = friend.value; if (!f) return
  const y = Number(bYear.value), m = Number(bMonth.value), d = Number(bDay.value)
  if (!Number.isInteger(y) || y < 1900 || y > 2100 || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) {
    uni.showToast({ title: '请填写有效的年月日', icon: 'none' }); return
  }
  const b: BirthInfo = { year: y, month: m, day: d }
  if (bHour.value !== '') { const h = Number(bHour.value); if (h >= 0 && h <= 23) b.hour = h }
  const all = storage.loadBirths(); all[f.id] = b; storage.saveBirths(all)
  friendBirth.value = b
  showBirthForm.value = false
  uni.showToast({ title: '已保存生辰', icon: 'success' })
}

const extracting = ref(false)
async function extractBirthFromChat() {
  const f = friend.value; if (!f) return
  extracting.value = true
  try {
    const b = await aiClient.extractBirth(f, samples.loadSamplesFor(f.id))
    if (b) {
      bYear.value = String(b.year); bMonth.value = String(b.month); bDay.value = String(b.day)
      bHour.value = b.hour != null ? String(b.hour) : ''
      uni.showToast({ title: '已从聊天预填，请确认', icon: 'none' })
    } else {
      uni.showToast({ title: '聊天里没找到生辰，请手填', icon: 'none' })
    }
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    extracting.value = false
  }
}

// 生成 / 刷新命理解读
async function generateAstro() {
  const f = friend.value; if (!f) return
  if (!myBazi.value) { goSetMyBazi(); return }
  if (!friendBirth.value) { openBirthForm(); return }
  loadingAstro.value = true
  try {
    const asm = assembleAstro(friendBirth.value, myBazi.value, todayParts())
    const reading = await aiClient.analyzeAstro(f, asm.friendChart, asm.fortune, asm.compat)
    const stored: StoredAstroReading = {
      reading, chart: asm.friendChart, generatedDate: todayStr(),
      birthFingerprint: birthFingerprint(friendBirth.value),
      myBaziFingerprint: birthFingerprint(myBazi.value),
    }
    const all = storage.loadAstroReading(); all[f.id] = stored; storage.saveAstroReading(all)
    astro.value = stored
    astroStale.value = false
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loadingAstro.value = false
  }
}
</script>
```

> 注：文件顶部已有一个 `onLoad((q) => { id.value = ... })`。保留它；上面新增的 `onShow` 负责生辰/缓存的载入与刷新。若同名 import（`onLoad`）已存在则复用，勿重复 import。

- [ ] **Step 2: `<template>` 追加命理卡**

在好友画像卡（`v-if="profile"` 那个 `<view class="card block">`）之后、聊天样本卡之前，插入：

```html
      <!-- 命理运势 -->
      <view class="card block">
        <view class="edit-row">
          <text class="block-t">☯ 命理运势</text>
          <text class="act act-ai" @click="generateAstro">
            {{ loadingAstro ? '推算中…' : (astro ? '刷新' : '生成') }}
          </text>
        </view>

        <!-- 态1：我的命盘未设置 -->
        <view v-if="!myBazi" class="astro-tip">
          <text class="astro-tip-t">合盘与流日相冲需要先设置「我的命盘」。</text>
          <text class="astro-set" @click="goSetMyBazi">去设置我的生辰 ›</text>
        </view>

        <!-- 态2：好友生辰缺失（或正在补录） -->
        <view v-else-if="!friendBirth || showBirthForm" class="astro-form">
          <text class="astro-tip-t">这位好友还没有生辰，补录后即可排盘：</text>
          <view class="row2"><text class="lbl2">年</text><input class="inp2" type="number" v-model="bYear" placeholder="如 1990" /></view>
          <view class="row2"><text class="lbl2">月</text><input class="inp2" type="number" v-model="bMonth" placeholder="1-12" /></view>
          <view class="row2"><text class="lbl2">日</text><input class="inp2" type="number" v-model="bDay" placeholder="1-31" /></view>
          <view class="row2"><text class="lbl2">时辰</text><input class="inp2" type="number" v-model="bHour" placeholder="0-23，选填" /></view>
          <view class="form-acts">
            <text class="act act-ai" @click="extractBirthFromChat">{{ extracting ? '抽取中…' : 'AI 从聊天抽取' }}</text>
            <text class="act" @click="saveBirth">保存生辰</text>
          </view>
        </view>

        <!-- 态3：齐全，有解读 -->
        <view v-else-if="astro" class="astro">
          <text v-if="astroStale" class="astro-stale">基于 {{ astro.generatedDate }} 生成，点「刷新」更新</text>
          <view class="astro-glance">
            <text class="ag-i">{{ astro.chart.pillars.year }} {{ astro.chart.pillars.month }} {{ astro.chart.pillars.day }}<text v-if="astro.chart.pillars.hour"> {{ astro.chart.pillars.hour }}</text></text>
            <text class="ag-sub">{{ astro.chart.zodiac }} · {{ astro.chart.constellation }}<text v-if="!astro.chart.pillars.hour"> · 未含时柱，结果偏粗</text></text>
          </view>
          <view class="prof-row"><text class="prof-k">性格</text><text class="prof-v">{{ astro.reading.personality || '暂无足够线索' }}</text></view>
          <view class="prof-row"><text class="prof-k">近期运势</text><text class="prof-v">{{ astro.reading.fortune || '暂无足够线索' }}</text></view>
          <view class="prof-row"><text class="prof-k">与我相性</text><text class="prof-v">{{ astro.reading.affinity || '暂无足够线索' }}</text></view>
          <view class="prof-row"><text class="prof-k">社交提示</text><text class="prof-v">{{ astro.reading.advice || '暂无足够线索' }}</text></view>
          <text class="senti-note faint">命理内容仅供娱乐参考</text>
          <text class="astro-reset" @click="openBirthForm">修改生辰</text>
        </view>

        <!-- 态3：齐全，尚未生成 -->
        <view v-else class="astro-tip">
          <text class="astro-tip-t">生辰已就绪，点右上「生成」查看命理运势。</text>
        </view>
      </view>
```

- [ ] **Step 3: `<style scoped>` 追加样式**

在 `friend-detail.vue` 的 `<style scoped>` 末尾追加（复用已有 `.prof-row/.prof-k/.prof-v/.act/.act-ai/.senti-note` 等）：

```css
.astro-tip { margin-top: 20rpx; padding: 24rpx; background: var(--accent-wash); border-radius: 16rpx; }
.astro-tip-t { display: block; font-size: 25rpx; color: var(--fg); line-height: 1.6; }
.astro-set, .astro-reset { display: inline-block; margin-top: 14rpx; font-size: 24rpx; color: var(--accent-strong); }
.astro-reset { margin-top: 18rpx; }
.astro-form { margin-top: 20rpx; }
.row2 { display: flex; align-items: center; justify-content: space-between; padding: 14rpx 0; border-top: 1rpx solid var(--border); }
.lbl2 { font-size: 25rpx; color: var(--muted); }
.inp2 { flex: 1; margin-left: 20rpx; height: 60rpx; padding: 0 18rpx; font-size: 25rpx; color: var(--fg); background: var(--surface); border: 1rpx solid var(--border-2); border-radius: 12rpx; text-align: right; }
.form-acts { display: flex; gap: 16rpx; margin-top: 20rpx; }
.astro { margin-top: 20rpx; }
.astro-stale { display: block; margin-bottom: 16rpx; padding: 10rpx 18rpx; font-size: 22rpx; color: #b8860b; background: rgba(184,134,11,0.1); border-radius: 10rpx; }
.astro-glance { padding: 20rpx; margin-bottom: 12rpx; background: var(--accent-wash); border-radius: 16rpx; }
.ag-i { display: block; font-size: 30rpx; font-weight: 700; letter-spacing: 4rpx; color: var(--accent-strong); }
.ag-sub { display: block; margin-top: 8rpx; font-size: 22rpx; color: var(--muted); }
```

- [ ] **Step 4: 构建小程序（PowerShell）**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 构建成功，无类型/编译错误。

- [ ] **Step 5: 跑 miniapp 全部单测（确认无回归）**

Run: `pnpm --filter @nianlun/miniapp exec vitest run`
Expected: 全绿。

- [ ] **Step 6: 手测清单（微信开发者工具）**

- [ ] 未设置我的命盘时：命理卡显示「去设置我的生辰」→ 点击进入设置页，保存后返回，卡片自动进入下一态。
- [ ] 好友无生辰：显示补录表单；点「AI 从聊天抽取」→ 有生辰则预填、无则提示手填；填好保存 → toast。
- [ ] 生辰齐全后点「生成」→ loading →渲染命盘速览（四柱/生肖/星座）+ 性格/运势/相性/社交提示 + 免责。
- [ ] 杀掉重进详情页：解读**直接展示**（持久化生效），无需重点。
- [ ] 把手机/模拟器日期调到次日重进：卡顶出现「基于 X 月 X 日生成，点刷新」提示，旧内容仍在；点「刷新」→ 重新生成、提示消失。
- [ ] 点「修改生辰」改动生辰 → 缓存标记过期（提示出现），刷新后更新。
- [ ] 缺时辰的生辰：命盘速览显示「未含时柱，结果偏粗」。

- [ ] **Step 7: 提交**

```bash
git add packages/miniapp/src/pages/friend-detail/friend-detail.vue
git commit -m "feat(miniapp): 好友详情页命理运势卡(三态/补录/生成/缓存刷新)"
```

---

## 自查（Self-Review）

**Spec 覆盖：**
- 命理档案提取（八字/性格/MBTI味道）→ Task 2（排盘）+ Task 5（性格解读）+ Task 11（展示）✓
- 流月流日 → Task 3 + Task 5（fortune 段）✓
- 合盘（含"冲课"=流日/生肖相冲）→ Task 4 + Task 5（affinity 段）✓
- 数据混合（AI 抽 + 手动补录）→ Task 5（extract）+ Task 9 + Task 11（表单/抽取）✓
- 我的命盘设置 → Task 10 ✓
- 社交提示（宜亲近/宜保持距离，软化）→ Task 5（advice + 约束）✓
- 持久化 + 跨天时效 → Task 7（存储）+ Task 8（指纹/过期）+ Task 11（载缓存/提示/刷新）✓
- 命盘速览确定性不经 AI → Task 11（用 astro.chart 直接渲染）✓
- 隐私（只发结构化盘+样本、生辰只存本机、免责）→ Task 5 prompt 约束 + Task 11 免责文案 ✓
- 塔罗归集 = 本版不做（spec 已砍）✓

**占位扫描：** 无 TBD/TODO；每个改代码的步骤都给了完整代码。

**类型一致性：** `BirthInfo/BaziChart/DayFortune/Compatibility`（Task 2 types.ts）→ Task 3/4/5/6 导出 → Task 7/8/9/11 消费，签名一致；`StoredAstroReading`（Task 7 定义）→ Task 11 消费一致；`AstroReading`（Task 5）→ Task 9/11 一致；`assembleAstro/birthFingerprint/astroExpired`（Task 8）→ Task 11 调用一致。

**风险点：** lunar-javascript 的具体 API 名（`getEightChar/getYearShengXiao/getXingZuo/getDayInGanZhi`）在 Task 1 Step 5 实测校准；若不符，同步修正 Task 2/3 的调用与 Task 1 的 `.d.ts` 垫片。
