# 二级市场荐股抽取引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把本机留存的全年微信原文，对金融/投资类好友的会话逐个调 AI 抽取结构化荐股记录，持久化供将来两个交叉视图直接读用。

**Architecture:** core 新增纯逻辑 `ai/stock.ts`（数据模型 + prompt/parse/merge/aggregate，扁平 `StockPick[]` 为唯一事实源，视图纯函数派生）。miniapp 新增编排 `stockAnalysis.ts`（读回原文→金融候选→带时间戳样本→分块→逐好友串行抽取，仿 `roleAnalysis` 容错范式），`aiClient` 加 `extractStocks`，`storage` 加分块荐股读写，导入页加「分析荐股」按钮。

**Tech Stack:** TypeScript、pnpm workspace monorepo、Vitest、Vue 3 + Pinia（uni-app 小程序）、既有 `aiProxy` 云函数（Claude `claude-opus-4-8`）。

## Global Constraints

- **单向依赖**：`@nianlun/miniapp → @nianlun/core`，core 永不 import miniapp、永不触碰 `window`/DOM/`IndexedDB`/`vue`。core 的 `tsconfig` 是 `"lib": ["ES2020"], "types": []`（`Date`/`Date.UTC` 属 ES2020，可用；`document`/`wx` 等不可用）。
- **解析容错**：所有 `parseXxx` 永不抛异常，无法解析返回空（`[]`/`{}`）。
- **隐私**：荐股结果与原文**仅存本机、绝不上传**；AI 仅经既有 `aiProxy` 通道传会话片段。
- **存储**：小程序单键 ≤ 1MB，大 blob 必须分块（复用 `RAW_CHUNK_CHARS = 200_000` 字符阈值）。写入失败只告警、绝不阻断。
- **命令**：core 测试 `pnpm --filter @nianlun/core exec vitest run <file>`；miniapp 测试 `pnpm --filter @nianlun/miniapp exec vitest run <file>`；core 构建 `pnpm --filter @nianlun/core build`（miniapp 依赖其 `dist/`）。
- **关键事实**：`Friend.id === Conversation.id === peerName`（现有所有 parser 如此，`extractFriendSamples`/`loadSamples` 也按此对应）。

---

## 文件结构

- Create `packages/core/src/ai/stock.ts` — 荐股数据模型 + 全部纯函数
- Create `packages/core/src/ai/__tests__/stock.test.ts` — core 单测
- Modify `packages/core/src/index.ts` — 导出新类型/函数
- Modify `packages/miniapp/src/adapters/storage.ts` — 分块荐股读写 + `clearAll`
- Modify `packages/miniapp/src/adapters/__tests__/storage.test.ts` — 荐股存储测试
- Modify `packages/miniapp/src/adapters/aiClient.ts` — `extractStocks`
- Modify `packages/miniapp/src/adapters/__tests__/aiClient.test.ts` — `extractStocks` 测试
- Create `packages/miniapp/src/adapters/stockAnalysis.ts` — 编排 + `isFinanceRole`
- Create `packages/miniapp/src/adapters/__tests__/stockAnalysis.test.ts` — 编排测试
- Modify `packages/miniapp/src/stores/import.ts` — `analyzeStocks` action
- Modify `packages/miniapp/src/stores/__tests__/import.test.ts` — action 测试
- Modify `packages/miniapp/src/pages/import/import.vue` — 「分析荐股」按钮

---

## Task 1: core 数据模型 + `normalizeStockName`

**Files:**
- Create: `packages/core/src/ai/stock.ts`
- Test: `packages/core/src/ai/__tests__/stock.test.ts`

**Interfaces:**
- Produces: 全部荐股类型（`StockPick` / `ExtractCtx` / `StockCard` / `RecommenderPicks`）与 `normalizeStockName(raw: string): string`。后续任务全部引用这些类型。

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/ai/__tests__/stock.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { normalizeStockName } from '../stock'

describe('normalizeStockName', () => {
  it('去首尾空格与内部空白', () => {
    expect(normalizeStockName(' 江 化微 ')).toBe('江化微')
  })
  it('去括号及其内容（中英文括号）', () => {
    expect(normalizeStockName('国瓷材料(A股)')).toBe('国瓷材料')
    expect(normalizeStockName('和林微纳（688661）')).toBe('和林微纳')
  })
  it('英文统一大写，使同名不同写法归一', () => {
    expect(normalizeStockName('abc')).toBe(normalizeStockName('ABC'))
  })
  it('非字符串返回空串', () => {
    expect(normalizeStockName(undefined as unknown as string)).toBe('')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/stock.test.ts`
Expected: FAIL（`normalizeStockName` 未定义 / 模块不存在）

- [ ] **Step 3: 写最小实现**

创建 `packages/core/src/ai/stock.ts`：

```ts
import type { Friend } from '../model/types'

/** 一条荐股原子记录 = 一次「谁推了哪支票」。唯一事实源。 */
export interface StockPick {
  stock: string
  stockNorm: string
  recommenderId: string
  recommender: string
  ts: number
  targetMarketCap?: string
  multiple?: string
  targetTime?: string
  currentPrice?: string
  logics: string[]
  companyNotes: string[]
  quote?: string
}

/** 解析/编排层注入给每条 pick 的上下文。 */
export interface ExtractCtx {
  recommenderId: string
  recommender: string
  fallbackTs: number
}

/** 视图A·以票查人：一支票的完整档案。 */
export interface StockCard {
  stockNorm: string
  displayName: string
  recommenderCount: number
  pickCount: number
  latestTargetMarketCap?: string
  latestMultiple?: string
  logics: string[]
  companyNotes: string[]
  picks: StockPick[]
}

/** 视图B·以人查票：某人推过的所有票。 */
export interface RecommenderPicks {
  recommenderId: string
  recommender: string
  stockCount: number
  picks: StockPick[]
}

/** 归并键规范化：去括号及内容、去空白、英文统一大写。 */
export function normalizeStockName(raw: string): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/[（(【[][^）)】\]]*[）)】\]]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase()
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/stock.test.ts`
Expected: PASS（4 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/ai/stock.ts packages/core/src/ai/__tests__/stock.test.ts
git commit -m "feat(core): 荐股数据模型 + normalizeStockName"
```

---

## Task 2: `parseStockExtraction`

**Files:**
- Modify: `packages/core/src/ai/stock.ts`
- Test: `packages/core/src/ai/__tests__/stock.test.ts`

**Interfaces:**
- Consumes: `StockPick`、`ExtractCtx`、`normalizeStockName`（Task 1）。
- Produces: `parseStockExtraction(text: string, ctx: ExtractCtx): StockPick[]`。

- [ ] **Step 1: 写失败测试**（追加到 stock.test.ts）

```ts
import { parseStockExtraction } from '../stock'
import type { ExtractCtx } from '../stock'

const CTX: ExtractCtx = { recommenderId: '张三', recommender: '张三首席', fallbackTs: 1000 }

describe('parseStockExtraction', () => {
  it('解析数组并注入 recommender/stockNorm/ts', () => {
    const text = JSON.stringify([
      { stock: '江化微', date: '2026-03-05', targetMarketCap: '500亿', multiple: '2倍',
        targetTime: '1年内', logics: ['MOC涨价'], companyNotes: ['半导体材料'], quote: '看2倍' },
    ])
    const [p] = parseStockExtraction(text, CTX)
    expect(p.stock).toBe('江化微')
    expect(p.stockNorm).toBe('江化微')
    expect(p.recommenderId).toBe('张三')
    expect(p.recommender).toBe('张三首席')
    expect(p.ts).toBe(Date.UTC(2026, 2, 5))
    expect(p.targetMarketCap).toBe('500亿')
    expect(p.logics).toEqual(['MOC涨价'])
  })
  it('剥离数组前后噪声后仍解析', () => {
    const text = '好的，结果如下：\n[{"stock":"和林微纳","logics":[],"companyNotes":[]}] —— 完毕'
    expect(parseStockExtraction(text, CTX)).toHaveLength(1)
  })
  it('日期解析失败回退 fallbackTs', () => {
    const text = JSON.stringify([{ stock: 'A', date: '前段时间' }])
    expect(parseStockExtraction(text, CTX)[0].ts).toBe(1000)
  })
  it('丢弃无 stock 的元素，logics/companyNotes 归一为字符串数组', () => {
    const text = JSON.stringify([{ date: '2026' }, { stock: 'B', logics: 'x', companyNotes: null }])
    const out = parseStockExtraction(text, CTX)
    expect(out).toHaveLength(1)
    expect(out[0].logics).toEqual([])
    expect(out[0].companyNotes).toEqual([])
  })
  it('坏 JSON / 非数组 → []', () => {
    expect(parseStockExtraction('不是 json', CTX)).toEqual([])
    expect(parseStockExtraction('{"stock":"A"}', CTX)).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/stock.test.ts`
Expected: FAIL（`parseStockExtraction` 未定义）

- [ ] **Step 3: 写实现**（追加到 stock.ts）

```ts
function pickStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}
function toStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
}
/** 把 YYYY / YYYY-MM / YYYY-MM-DD 解析为毫秒 ts；失败返回 fallback。用 Date.UTC 保确定性。 */
function parseDateToTs(date: unknown, fallback: number): number {
  if (typeof date !== 'string') return fallback
  const m = date.trim().match(/^(\d{4})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?/)
  if (!m) return fallback
  const y = Number(m[1]); const mo = m[2] ? Number(m[2]) : 1; const d = m[3] ? Number(m[3]) : 1
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return fallback
  return Date.UTC(y, mo - 1, d)
}

/** 容错解析 AI 荐股抽取结果为 StockPick[]；注入 ctx；永不抛。 */
export function parseStockExtraction(text: string, ctx: ExtractCtx): StockPick[] {
  if (typeof text !== 'string') return []
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return []
  let arr: unknown
  try { arr = JSON.parse(text.slice(start, end + 1)) } catch { return [] }
  if (!Array.isArray(arr)) return []
  const out: StockPick[] = []
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    const stock = pickStr(r.stock)
    if (!stock) continue
    const pick: StockPick = {
      stock,
      stockNorm: normalizeStockName(stock),
      recommenderId: ctx.recommenderId,
      recommender: ctx.recommender,
      ts: parseDateToTs(r.date, ctx.fallbackTs),
      logics: toStrArray(r.logics),
      companyNotes: toStrArray(r.companyNotes),
    }
    const tmc = pickStr(r.targetMarketCap); if (tmc) pick.targetMarketCap = tmc
    const mul = pickStr(r.multiple); if (mul) pick.multiple = mul
    const tt = pickStr(r.targetTime); if (tt) pick.targetTime = tt
    const q = pickStr(r.quote); if (q) pick.quote = q
    out.push(pick)
  }
  return out
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/stock.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/ai/stock.ts packages/core/src/ai/__tests__/stock.test.ts
git commit -m "feat(core): parseStockExtraction 容错解析荐股 JSON"
```

---

## Task 3: `mergeStockPicks`

**Files:**
- Modify: `packages/core/src/ai/stock.ts`
- Test: `packages/core/src/ai/__tests__/stock.test.ts`

**Interfaces:**
- Consumes: `StockPick`（Task 1）。
- Produces: `mergeStockPicks(existing: StockPick[], incoming: StockPick[]): StockPick[]`（去重键 `stockNorm|recommenderId|ts|quote`）。

- [ ] **Step 1: 写失败测试**（追加）

```ts
import { mergeStockPicks } from '../stock'

const mk = (over: Partial<import('../stock').StockPick> = {}): import('../stock').StockPick => ({
  stock: '江化微', stockNorm: '江化微', recommenderId: '张三', recommender: '张三首席',
  ts: 100, logics: [], companyNotes: [], ...over,
})

describe('mergeStockPicks', () => {
  it('同键去重、保序追加', () => {
    const a = [mk()]
    const b = [mk(), mk({ quote: '另一条' })]
    const out = mergeStockPicks(a, b)
    expect(out).toHaveLength(2)
    expect(out[1].quote).toBe('另一条')
  })
  it('不同票/不同人/不同时间视为不同记录', () => {
    const out = mergeStockPicks([mk()], [mk({ stockNorm: 'B' }), mk({ recommenderId: '李四' }), mk({ ts: 200 })])
    expect(out).toHaveLength(4)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/stock.test.ts`
Expected: FAIL（`mergeStockPicks` 未定义）

- [ ] **Step 3: 写实现**（追加到 stock.ts）

```ts
const pickKey = (p: StockPick) => `${p.stockNorm}|${p.recommenderId}|${p.ts}|${p.quote ?? ''}`

/** 去重合并两批荐股记录，保持顺序（existing 在前）。 */
export function mergeStockPicks(existing: StockPick[], incoming: StockPick[]): StockPick[] {
  const seen = new Set(existing.map(pickKey))
  const out = [...existing]
  for (const p of incoming) {
    const k = pickKey(p)
    if (!seen.has(k)) { seen.add(k); out.push(p) }
  }
  return out
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/stock.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/ai/stock.ts packages/core/src/ai/__tests__/stock.test.ts
git commit -m "feat(core): mergeStockPicks 去重合并"
```

---

## Task 4: `aggregateByStock`（视图A）

**Files:**
- Modify: `packages/core/src/ai/stock.ts`
- Test: `packages/core/src/ai/__tests__/stock.test.ts`

**Interfaces:**
- Consumes: `StockPick`、`StockCard`（Task 1）。
- Produces: `aggregateByStock(picks: StockPick[]): StockCard[]`。

- [ ] **Step 1: 写失败测试**（追加；复用 Task 3 的 `mk`）

```ts
import { aggregateByStock } from '../stock'

describe('aggregateByStock', () => {
  it('按 stockNorm 聚合：recommenderCount 计不同人、displayName 取高频写法、latest 取最新非空', () => {
    const picks = [
      mk({ stock: '江化微', recommenderId: '张三', ts: 100, targetMarketCap: '500亿', logics: ['L1'] }),
      mk({ stock: '江化微', recommenderId: '李四', ts: 300, multiple: '3倍', logics: ['L1', 'L2'] }),
      mk({ stock: '江化微科技', recommenderId: '李四', ts: 200 }),
    ]
    const [card] = aggregateByStock(picks)
    expect(card.stockNorm).toBe('江化微')            // 中文 toUpperCase 不变
    expect(card.recommenderCount).toBe(2)
    expect(card.pickCount).toBe(3)
    expect(card.displayName).toBe('江化微')          // 出现 2 次 > 江化微科技 1 次
    expect(card.latestMultiple).toBe('3倍')          // ts=300 那条
    expect(card.latestTargetMarketCap).toBe('500亿') // ts=300 无市值 → 回退到有值的最新(ts=100)
    expect(card.logics).toEqual(['L1', 'L2'])        // 去重合并
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/stock.test.ts`
Expected: FAIL（`aggregateByStock` 未定义）

- [ ] **Step 3: 写实现**（追加到 stock.ts）

```ts
function dedup(a: string[]): string[] { return [...new Set(a)] }

/** 视图A：按 stockNorm 聚合成票卡片（三层信息在此归纳）。 */
export function aggregateByStock(picks: StockPick[]): StockCard[] {
  const groups = new Map<string, StockPick[]>()
  for (const p of picks) {
    const g = groups.get(p.stockNorm)
    if (g) g.push(p); else groups.set(p.stockNorm, [p])
  }
  const cards: StockCard[] = []
  for (const [stockNorm, gp] of groups) {
    const nameCount = new Map<string, number>()
    for (const p of gp) nameCount.set(p.stock, (nameCount.get(p.stock) ?? 0) + 1)
    let displayName = gp[0].stock; let best = 0
    for (const [n, c] of nameCount) if (c > best) { best = c; displayName = n }
    const byTsDesc = [...gp].sort((a, b) => b.ts - a.ts)
    const card: StockCard = {
      stockNorm,
      displayName,
      recommenderCount: new Set(gp.map((p) => p.recommenderId)).size,
      pickCount: gp.length,
      logics: dedup(gp.flatMap((p) => p.logics)),
      companyNotes: dedup(gp.flatMap((p) => p.companyNotes)),
      picks: gp,
    }
    const tmc = byTsDesc.find((p) => p.targetMarketCap)?.targetMarketCap
    const mul = byTsDesc.find((p) => p.multiple)?.multiple
    if (tmc) card.latestTargetMarketCap = tmc
    if (mul) card.latestMultiple = mul
    cards.push(card)
  }
  return cards
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/stock.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/ai/stock.ts packages/core/src/ai/__tests__/stock.test.ts
git commit -m "feat(core): aggregateByStock 视图A(以票查人)"
```

---

## Task 5: `aggregateByRecommender`（视图B）

**Files:**
- Modify: `packages/core/src/ai/stock.ts`
- Test: `packages/core/src/ai/__tests__/stock.test.ts`

**Interfaces:**
- Consumes: `StockPick`、`RecommenderPicks`（Task 1）。
- Produces: `aggregateByRecommender(picks: StockPick[]): RecommenderPicks[]`。

- [ ] **Step 1: 写失败测试**（追加；复用 `mk`）

```ts
import { aggregateByRecommender } from '../stock'

describe('aggregateByRecommender', () => {
  it('按 recommenderId 聚合，stockCount 计不同 stockNorm', () => {
    const picks = [
      mk({ recommenderId: '张三', recommender: '张三首席', stockNorm: 'A' }),
      mk({ recommenderId: '张三', recommender: '张三首席', stockNorm: 'B' }),
      mk({ recommenderId: '张三', recommender: '张三首席', stockNorm: 'A', ts: 999 }),
      mk({ recommenderId: '李四', recommender: '李四', stockNorm: 'A' }),
    ]
    const out = aggregateByRecommender(picks).sort((a, b) => a.recommenderId.localeCompare(b.recommenderId))
    expect(out).toHaveLength(2)
    const zhang = out.find((r) => r.recommenderId === '张三')!
    expect(zhang.recommender).toBe('张三首席')
    expect(zhang.picks).toHaveLength(3)
    expect(zhang.stockCount).toBe(2)   // A、B
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/stock.test.ts`
Expected: FAIL（`aggregateByRecommender` 未定义）

- [ ] **Step 3: 写实现**（追加到 stock.ts）

```ts
/** 视图B：按推荐人聚合。 */
export function aggregateByRecommender(picks: StockPick[]): RecommenderPicks[] {
  const groups = new Map<string, StockPick[]>()
  for (const p of picks) {
    const g = groups.get(p.recommenderId)
    if (g) g.push(p); else groups.set(p.recommenderId, [p])
  }
  const out: RecommenderPicks[] = []
  for (const [recommenderId, gp] of groups) {
    out.push({
      recommenderId,
      recommender: gp[0].recommender,
      stockCount: new Set(gp.map((p) => p.stockNorm)).size,
      picks: gp,
    })
  }
  return out
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/stock.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/ai/stock.ts packages/core/src/ai/__tests__/stock.test.ts
git commit -m "feat(core): aggregateByRecommender 视图B(以人查票)"
```

---

## Task 6: `buildStockExtractionPrompt`

**Files:**
- Modify: `packages/core/src/ai/stock.ts`
- Test: `packages/core/src/ai/__tests__/stock.test.ts`

**Interfaces:**
- Consumes: `Friend`（`@nianlun/core` model）。
- Produces: `buildStockExtractionPrompt(friend: Friend, samples: string[]): string`。

- [ ] **Step 1: 写失败测试**（追加）

```ts
import { buildStockExtractionPrompt } from '../stock'
import type { Friend } from '../../model/types'

const FR = { id: '张三', name: '张三', alias: '张三首席', rel: '客户', role: '首席',
  firstContact: 0, lastContact: 0, msgCount: 9, sentRatio: 0, peakPeriod: '', maxStreak: 0,
  monthly: [], hourly: [], weekHour: [], keywords: [], userEdited: {} } as unknown as Friend

describe('buildStockExtractionPrompt', () => {
  it('含关键约束、空数组指示、好友名与编号样本', () => {
    const p = buildStockExtractionPrompt(FR, ['2026-03-05 对方：江化微看2倍'])
    expect(p).toContain('张三首席')
    expect(p).toContain('JSON 数组')
    expect(p).toContain('[]')
    expect(p).toContain('1. 2026-03-05 对方：江化微看2倍')
  })
  it('无样本给占位', () => {
    expect(buildStockExtractionPrompt(FR, [])).toContain('（本次无可用聊天样本）')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/stock.test.ts`
Expected: FAIL（`buildStockExtractionPrompt` 未定义）

- [ ] **Step 3: 写实现**（追加到 stock.ts）

```ts
/** 单个好友 + 带日期样本 → 荐股抽取提示词，要求 AI 只输出严格 JSON 数组。 */
export function buildStockExtractionPrompt(friend: Friend, samples: string[]): string {
  const displayName = friend.alias || friend.name
  const sampleBlock = samples.length
    ? samples.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '（本次无可用聊天样本）'
  return [
    '你是一位擅长从聊天记录中抽取「荐股信息」的金融助理。',
    `下面是与「${displayName}」的部分聊天样本，请找出其中所有「推荐 / 看好某支股票」的记录。`,
    '',
    '只输出一个严格的 JSON 数组，不要任何解释、不要代码围栏外的文字。',
    '若样本中没有任何荐股信息，输出空数组 []。',
    '每个数组元素格式：',
    '{',
    '  "stock": "<股票名称，必填>",',
    '  "date": "<推荐时间，取样本行首日期，如 2026-03-05；无法确定留空>",',
    '  "targetMarketCap": "<目标市值，如 500亿；无则省略>",',
    '  "multiple": "<涨幅倍数，如 2倍；无则省略>",',
    '  "targetTime": "<预计到达时间，如 1年内；无则省略>",',
    '  "logics": ["<推荐逻辑，分条>"],',
    '  "companyNotes": ["<公司信息或「谁说了什么」的评价，分条>"],',
    '  "quote": "<最能代表该荐股的原话摘录>"',
    '}',
    '',
    '要求：只抽确有荐股含义的内容；目标价 / 倍数等无明确依据时宁可省略，禁止臆造。',
    '',
    '聊天样本（每行以日期开头，「我」为用户本人，「对方」为该好友）：',
    sampleBlock,
  ].join('\n')
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/stock.test.ts`
Expected: PASS（全文件用例）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/ai/stock.ts packages/core/src/ai/__tests__/stock.test.ts
git commit -m "feat(core): buildStockExtractionPrompt 荐股抽取提示词"
```

---

## Task 7: core 导出

**Files:**
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: 从 `@nianlun/core` 导出 `StockPick` / `ExtractCtx` / `StockCard` / `RecommenderPicks` 类型与 `normalizeStockName` / `parseStockExtraction` / `mergeStockPicks` / `aggregateByStock` / `aggregateByRecommender` / `buildStockExtractionPrompt` 函数。miniapp 后续任务依赖此导出。

- [ ] **Step 1: 追加导出**

在 `packages/core/src/index.ts` 末尾追加：

```ts
export {
  normalizeStockName, parseStockExtraction, mergeStockPicks,
  aggregateByStock, aggregateByRecommender, buildStockExtractionPrompt,
} from './ai/stock'
export type { StockPick, ExtractCtx, StockCard, RecommenderPicks } from './ai/stock'
```

- [ ] **Step 2: 构建 core，确认类型/导出无误**

Run: `pnpm --filter @nianlun/core build`
Expected: 成功产出 `dist/`，无 TS 错误。（miniapp 依赖该 dist 才能 import 新符号。）

- [ ] **Step 3: 跑 core 全量测试**

Run: `pnpm --filter @nianlun/core test`
Expected: PASS（含 stock.test.ts 与既有测试）

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): 导出荐股抽取模型与纯函数"
```

---

## Task 8: storage 分块荐股读写

**Files:**
- Modify: `packages/miniapp/src/adapters/storage.ts`
- Test: `packages/miniapp/src/adapters/__tests__/storage.test.ts`

**Interfaces:**
- Consumes: `StockPick`（`@nianlun/core`）、`RRAW_CHUNK_CHARS`（复用现有阈值常量）、`StorageBackend`。
- Produces: `storage.saveStockPicks(picks: StockPick[]): void`、`storage.loadStockPicks(): StockPick[]`、`storage.clearStockPicks(): void`；`clearAll()` 追加清理荐股。

- [ ] **Step 1: 写失败测试**（追加到 storage.test.ts）

```ts
import type { StockPick } from '@nianlun/core'

const PICK = (over: Partial<StockPick> = {}): StockPick => ({
  stock: '江化微', stockNorm: '江化微', recommenderId: '张三', recommender: '张三首席',
  ts: 100, logics: [], companyNotes: [], ...over,
})

describe('storage 荐股', () => {
  it('saveStockPicks / loadStockPicks 往返', () => {
    const s = makeStorage(memBackend())
    s.saveStockPicks([PICK(), PICK({ stock: 'B', stockNorm: 'B' })])
    expect(s.loadStockPicks().map((p) => p.stock)).toEqual(['江化微', 'B'])
  })
  it('超单块阈值的大数据分块并完整读回', () => {
    const s = makeStorage(memBackend())
    const big = Array.from({ length: 5000 }, (_, i) => PICK({ quote: 'x'.repeat(100) + i }))
    s.saveStockPicks(big)
    expect(s.loadStockPicks()).toHaveLength(5000)
  })
  it('无数据 → []', () => {
    expect(makeStorage(memBackend()).loadStockPicks()).toEqual([])
  })
  it('clearAll 后荐股为 []', () => {
    const s = makeStorage(memBackend())
    s.saveStockPicks([PICK()])
    s.clearAll()
    expect(s.loadStockPicks()).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts`
Expected: FAIL（`saveStockPicks` 不存在）

- [ ] **Step 3: 写实现**

在 `storage.ts` 顶部 import 处加类型：

```ts
import type { Friend, ReportData, StockPick } from '@nianlun/core'
```

在 `K_RAW` 常量附近加键与通用分块 helper（放在 `makeStorage` 之前）：

```ts
const K_STOCKS_INDEX = 'nianlun:stockIndex'
const K_STOCKS = (i: number) => `nianlun:stocks:${i}`

/** 通用「数组分块存 Storage」helper（绕过单键 1MB 限制）：覆盖写 / 读回 / 清除。 */
function makeChunkedArray<T>(backend: StorageBackend, indexKey: string, dataKey: (i: number) => string) {
  function chunkCount(): number {
    const idx = backend.get(indexKey)
    return idx && typeof idx === 'object' && typeof (idx as { count?: unknown }).count === 'number'
      ? (idx as { count: number }).count : 0
  }
  function clear(): void {
    const c = chunkCount()
    for (let i = 0; i < c; i++) backend.remove(dataKey(i))
    backend.remove(indexKey)
  }
  function load(): T[] {
    const c = chunkCount()
    if (!c) return []
    let blob = ''
    for (let i = 0; i < c; i++) {
      const s = backend.get(dataKey(i))
      if (typeof s !== 'string') return []
      blob += s
    }
    try { const arr = JSON.parse(blob); return Array.isArray(arr) ? (arr as T[]) : [] } catch { return [] }
  }
  function save(items: T[]): void {
    clear()
    const blob = JSON.stringify(items)
    let count = 0
    for (let i = 0; i < blob.length; i += RAW_CHUNK_CHARS) {
      backend.set(dataKey(count), blob.slice(i, i + RAW_CHUNK_CHARS))
      count++
    }
    backend.set(indexKey, { count })
  }
  return { clear, load, save }
}
```

在 `makeStorage` 内、`return {` 之前实例化：

```ts
  const stocks = makeChunkedArray<StockPick>(backend, K_STOCKS_INDEX, K_STOCKS)
```

在返回对象里、`clearRaw` 之后加三个方法：

```ts
    saveStockPicks(picks: StockPick[]): void { stocks.save(picks) },
    loadStockPicks(): StockPick[] { return stocks.load() },
    clearStockPicks(): void { stocks.clear() },
```

`clearAll()` 末尾追加一行：

```ts
      clearRawImpl()
      stocks.clear()   // ← 新增
```

- [ ] **Step 4: 跑测试确认通过（含既有 raw/friends 测试不回归）**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts`
Expected: PASS（新荐股用例 + 既有全部）

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/storage.ts packages/miniapp/src/adapters/__tests__/storage.test.ts
git commit -m "feat(miniapp): storage 分块持久化荐股记录"
```

---

## Task 9: `aiClient.extractStocks`

**Files:**
- Modify: `packages/miniapp/src/adapters/aiClient.ts`
- Test: `packages/miniapp/src/adapters/__tests__/aiClient.test.ts`

**Interfaces:**
- Consumes: `buildStockExtractionPrompt`、`parseStockExtraction`、`StockPick`、`ExtractCtx`（`@nianlun/core`）、`Transport`。
- Produces: `makeAiClient(transport).extractStocks(friend: Friend, samples: string[], ctx: ExtractCtx): Promise<StockPick[]>`。

- [ ] **Step 1: 写失败测试**（追加到 aiClient.test.ts）

```ts
import type { ExtractCtx } from '@nianlun/core'

it('extractStocks 走荐股 prompt 并解析为 StockPick[]', async () => {
  const transport = vi.fn().mockResolvedValue('[{"stock":"江化微","logics":["MOC涨价"],"companyNotes":[]}]')
  const ctx: ExtractCtx = { recommenderId: 'f1', recommender: '张三', fallbackTs: 100 }
  const out = await makeAiClient(transport).extractStocks(FRIEND, ['2026-03-05 对方：江化微看2倍'], ctx)
  expect(out).toHaveLength(1)
  expect(out[0].stock).toBe('江化微')
  expect(out[0].recommenderId).toBe('f1')       // ctx 注入
  expect(transport.mock.calls[0][0]).toContain('JSON 数组')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/aiClient.test.ts`
Expected: FAIL（`extractStocks` 不存在）

- [ ] **Step 3: 写实现**

在 `aiClient.ts` 顶部 import 增补：

```ts
import {
  buildReportCopyPrompt, buildFriendSuggestionPrompt, parseFriendSuggestion,
  buildFriendSentimentPrompt, buildYearSentimentPrompt, parseSentiment,
  buildFriendProfilePrompt, parseFriendProfile,
  buildStockExtractionPrompt, parseStockExtraction,   // ← 新增
} from '@nianlun/core'
import type {
  Friend, ReportData, FriendSuggestion, Sentiment, FriendProfile,
  StockPick, ExtractCtx,                                // ← 新增
} from '@nianlun/core'
```

在 `makeAiClient` 返回对象里追加方法（`analyzeYearSentiment` 之后）：

```ts
    async extractStocks(friend: Friend, samples: string[], ctx: ExtractCtx): Promise<StockPick[]> {
      const text = await transport(buildStockExtractionPrompt(friend, samples), 2048)
      return parseStockExtraction(text, ctx)
    },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/aiClient.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/aiClient.ts packages/miniapp/src/adapters/__tests__/aiClient.test.ts
git commit -m "feat(miniapp): aiClient.extractStocks 封装荐股抽取调用"
```

---

## Task 10: `stockAnalysis` 编排 + `isFinanceRole`

**Files:**
- Create: `packages/miniapp/src/adapters/stockAnalysis.ts`
- Test: `packages/miniapp/src/adapters/__tests__/stockAnalysis.test.ts`

**Interfaces:**
- Consumes: `Conversation`、`Friend`、`StockPick`、`ExtractCtx`、`mergeStockPicks`（`@nianlun/core`）。
- Produces:
  - `isFinanceRole(f: Friend): boolean`
  - `analyzeStocks(deps: AnalyzeStocksDeps): Promise<AnalyzeStocksResult>`
  - `AnalyzeStocksDeps { conversations: Conversation[]; friends: Friend[]; targetIds?: string[]; isFinanceFriend?: (f: Friend) => boolean; extract: (f: Friend, samples: string[], ctx: ExtractCtx) => Promise<StockPick[]>; onProgress?: (done: number, total: number) => void }`
  - `AnalyzeStocksResult { picks: StockPick[]; analyzed: number; withPicks: number; failed: number; firstError?: string }`

- [ ] **Step 1: 写失败测试**

创建 `packages/miniapp/src/adapters/__tests__/stockAnalysis.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { analyzeStocks, isFinanceRole } from '../stockAnalysis'
import type { Conversation, Friend, StockPick, ExtractCtx } from '@nianlun/core'

const F = (id: string, role = ''): Friend => ({
  id, name: id, alias: '', rel: '其他', role, firstContact: 0, lastContact: 0,
  msgCount: 1, sentRatio: 0, peakPeriod: '', maxStreak: 0,
  monthly: new Array(12).fill(0), hourly: new Array(24).fill(0), weekHour: new Array(168).fill(0),
  keywords: [], userEdited: {},
})
const conv = (id: string, texts: string[]): Conversation => ({
  id, peerName: id, isGroup: false,
  messages: texts.map((t, i) => ({ ts: 1000 + i, from: 'them', type: 'text', text: t })),
})
const pick = (over: Partial<StockPick> = {}): StockPick => ({
  stock: '江化微', stockNorm: '江化微', recommenderId: 'x', recommender: 'x',
  ts: 1, logics: [], companyNotes: [], ...over,
})

describe('isFinanceRole', () => {
  it('role 命中金融关键词 → true；否则 false', () => {
    expect(isFinanceRole(F('a', '首席'))).toBe(true)
    expect(isFinanceRole(F('b', '家人'))).toBe(false)
  })
})

describe('analyzeStocks', () => {
  it('无白名单时仅金融类好友被抽取', async () => {
    const extract = vi.fn().mockResolvedValue([pick()])
    const r = await analyzeStocks({
      conversations: [conv('a', ['江化微看2倍']), conv('b', ['吃饭没'])],
      friends: [F('a', '首席'), F('b', '同学')],
      extract,
    })
    expect(extract).toHaveBeenCalledTimes(1)      // 只 a
    expect(r.analyzed).toBe(1)
    expect(r.withPicks).toBe(1)
    expect(r.picks).toHaveLength(1)
  })
  it('白名单优先于金融启发式', async () => {
    const extract = vi.fn().mockResolvedValue([])
    await analyzeStocks({
      conversations: [conv('a', ['x']), conv('b', ['y'])],
      friends: [F('a', '首席'), F('b', '同学')],
      targetIds: ['b'], extract,
    })
    expect(extract).toHaveBeenCalledTimes(1)
    expect(extract.mock.calls[0][0].id).toBe('b')  // 抽的是白名单里的 b
  })
  it('超长会话分块多次抽取并 merge 去重', async () => {
    const long = Array.from({ length: 200 }, (_, i) => '这是一条很长很长很长很长很长很长的消息' + i)
    const extract = vi.fn().mockResolvedValue([pick()])
    const r = await analyzeStocks({
      conversations: [conv('a', long)], friends: [F('a', '首席')], extract,
    })
    expect(extract.mock.calls.length).toBeGreaterThan(1)  // 分了多块
    expect(r.picks).toHaveLength(1)                        // 相同 pick 被 merge 去重
  })
  it('extract 抛异常 → 计入 failed、不中断、记录 firstError', async () => {
    const extract = vi.fn()
      .mockRejectedValueOnce(new Error('云函数超时'))
      .mockResolvedValueOnce([pick()])
    const r = await analyzeStocks({
      conversations: [conv('a', ['x']), conv('b', ['y'])],
      friends: [F('a', '首席'), F('b', '基金经理')], extract,
    })
    expect(r.failed).toBe(1)
    expect(r.firstError).toBe('云函数超时')
    expect(r.picks).toHaveLength(1)
  })
  it('onProgress 从 0 起、到 total 结束', async () => {
    const extract = vi.fn().mockResolvedValue([])
    const calls: Array<[number, number]> = []
    await analyzeStocks({
      conversations: [conv('a', ['x']), conv('b', ['y'])],
      friends: [F('a', '首席'), F('b', '券商')],
      extract, onProgress: (d, t) => calls.push([d, t]),
    })
    expect(calls[0]).toEqual([0, 2])
    expect(calls[calls.length - 1]).toEqual([2, 2])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/stockAnalysis.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

创建 `packages/miniapp/src/adapters/stockAnalysis.ts`：

```ts
import { mergeStockPicks } from '@nianlun/core'
import type { Conversation, Friend, StockPick, ExtractCtx } from '@nianlun/core'

/** 金融/投资类默认启发式：role/alias/name 命中关键词即候选。白名单永远优先。 */
const FINANCE_KW = /首席|投资|私募|券商|基金|研究员|分析师|资管|证券|操盘|游资|经济学家|股票|荐股/
export function isFinanceRole(f: Friend): boolean {
  return FINANCE_KW.test(`${f.role} ${f.alias} ${f.name}`)
}

/** 单块样本字符预算，留 AI 输入余量。 */
const SAMPLE_CHUNK_CHARS = 6000

export interface AnalyzeStocksDeps {
  conversations: Conversation[]
  friends: Friend[]
  targetIds?: string[]
  isFinanceFriend?: (f: Friend) => boolean
  extract: (f: Friend, samples: string[], ctx: ExtractCtx) => Promise<StockPick[]>
  onProgress?: (done: number, total: number) => void
}

export interface AnalyzeStocksResult {
  picks: StockPick[]
  analyzed: number
  withPicks: number
  failed: number
  firstError?: string
}

function pad2(n: number): string { return n < 10 ? '0' + n : String(n) }

/** 会话文本消息 → 带日期前缀的样本行 + 兜底推荐时间(消息时间中值)。 */
function datedSamples(conv: Conversation): { lines: string[]; fallbackTs: number } {
  const msgs = conv.messages
    .filter((m) => m.type === 'text' && typeof m.text === 'string' && m.text.trim() !== '')
    .slice()
    .sort((a, b) => a.ts - b.ts)
  const lines = msgs.map((m) => {
    const d = new Date(m.ts)
    const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    const who = m.from === 'me' ? '我' : '对方'
    return `${date} ${who}：${(m.text ?? '').trim()}`
  })
  const fallbackTs = msgs.length ? msgs[Math.floor(msgs.length / 2)].ts : 0
  return { lines, fallbackTs }
}

/** 按字符预算把样本行切成多块（单行超预算也自成一块）。 */
function chunkByChars(lines: string[], max: number): string[][] {
  const chunks: string[][] = []
  let cur: string[] = []
  let len = 0
  for (const line of lines) {
    if (cur.length && len + line.length > max) { chunks.push(cur); cur = []; len = 0 }
    cur.push(line)
    len += line.length
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

/** 对金融候选好友逐个（会话内再分块）串行抽取荐股，容错、进度、统计。 */
export async function analyzeStocks(deps: AnalyzeStocksDeps): Promise<AnalyzeStocksResult> {
  const { conversations, friends, targetIds, extract, onProgress } = deps
  const isFinance = deps.isFinanceFriend ?? isFinanceRole
  const convById = new Map(conversations.map((c) => [c.id, c]))
  const candidates = targetIds
    ? friends.filter((f) => targetIds.includes(f.id))
    : friends.filter(isFinance)

  const total = candidates.length
  if (total) onProgress?.(0, total)

  let all: StockPick[] = []
  let analyzed = 0
  let withPicks = 0
  let failed = 0
  let firstError: string | undefined
  let done = 0

  for (const f of candidates) {
    analyzed++
    const conv = convById.get(f.id)
    try {
      if (conv) {
        const { lines, fallbackTs } = datedSamples(conv)
        const ctx: ExtractCtx = { recommenderId: f.id, recommender: f.alias || f.name, fallbackTs }
        let picks: StockPick[] = []
        for (const chunk of chunkByChars(lines, SAMPLE_CHUNK_CHARS)) {
          const got = await extract(f, chunk, ctx)
          picks = mergeStockPicks(picks, got)
        }
        if (picks.length) withPicks++
        all = mergeStockPicks(all, picks)
      }
    } catch (e) {
      failed++
      if (firstError === undefined) firstError = (e as Error)?.message ?? String(e)
    }
    done++
    onProgress?.(done, total)
  }
  return { picks: all, analyzed, withPicks, failed, firstError }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/stockAnalysis.test.ts`
Expected: PASS（6 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/stockAnalysis.ts packages/miniapp/src/adapters/__tests__/stockAnalysis.test.ts
git commit -m "feat(miniapp): stockAnalysis 编排(金融候选+分块+串行抽取)"
```

---

## Task 11: import store `analyzeStocks` action + 导入页按钮

**Files:**
- Modify: `packages/miniapp/src/stores/import.ts`
- Test: `packages/miniapp/src/stores/__tests__/import.test.ts`
- Modify: `packages/miniapp/src/pages/import/import.vue`

**Interfaces:**
- Consumes: `parseFile`、`mergeConversations`、`Conversation`（`@nianlun/core`）、`analyzeStocks as runAnalyzeStocks`、`isFinanceRole`（`stockAnalysis`）、`aiClient.extractStocks`、`storage`。
- Produces: import store 暴露 `analyzeStocks(): Promise<void>`、`analyzingStocks: Ref<{done:number;total:number}|null>`、`stocksSavedCount: Ref<number>`。

- [ ] **Step 1: 写失败测试**（追加到 import.test.ts）

```ts
import { createImportStore } from '../import'
import { setActivePinia, createPinia } from 'pinia'
import { makeStorage } from '../../adapters/storage'

function memBackend() {
  const m = new Map<string, unknown>()
  return { get: (k: string) => m.get(k), set: (k: string, v: unknown) => void m.set(k, v), remove: (k: string) => void m.delete(k) }
}

it('analyzeStocks: 读回原文→抽取→saveStockPicks，并暴露统计', async () => {
  setActivePinia(createPinia())
  const storage = makeStorage(memBackend())
  // 预置一条留存原文(txt 格式：头行「日期时间 发送者」+ 正文 + 空行)
  storage.saveRawFiles([{ name: 'a.txt', content: '2026-03-05 10:00:00 张三\n江化微看2倍\n\n' }])
  const extract = vi.fn().mockResolvedValue([
    { stock: '江化微', stockNorm: '江化微', recommenderId: '张三', recommender: '张三', ts: 1, logics: [], companyNotes: [] },
  ])
  const useImport = createImportStore({
    storage,
    extractStocks: extract,   // useData 用默认真实 data store（下方 setData 塞入候选好友）
  } as never)
  const imp = useImport()
  // 直接把好友塞进 data store
  const { useDataStore } = await import('../data')
  await useDataStore().setData(
    [{ id: '张三', name: '张三', alias: '', rel: '客户', role: '首席', firstContact: 0, lastContact: 0,
       msgCount: 9, sentRatio: 0, peakPeriod: '', maxStreak: 0, monthly: new Array(12).fill(0),
       hourly: new Array(24).fill(0), weekHour: new Array(168).fill(0), keywords: [], userEdited: {} }] as never,
    { year: 2026, totalMessages: 1, friendCount: 1, activeDays: 1, topContacts: [], latestMessage: null, keywords: [], relationBreakdown: [] } as never,
  )
  await imp.analyzeStocks()
  expect(extract).toHaveBeenCalled()
  expect(storage.loadStockPicks()).toHaveLength(1)
  expect(imp.stocksSavedCount).toBe(1)
  expect(imp.analyzingStocks).toBeNull()
})
```

> 实现说明：`createImportStore` 已支持 `deps.storage`；本任务新增 `deps.extractStocks`。测试用真实 `useDataStore`（默认注入），通过 `setData` 塞入 id='张三'、role='首席' 的候选好友。若既有 import.test.ts 已有 `memBackend`/pinia 初始化，复用之，勿重复定义。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/import.test.ts`
Expected: FAIL（`analyzeStocks` / `analyzingStocks` / `stocksSavedCount` 不存在）

- [ ] **Step 3: 写实现**

在 `import.ts` 顶部 import 增补：

```ts
import { mergeFriends, applyContactNames, parseWeliveContacts, isWeliveContacts,
  parseFile, mergeConversations } from '@nianlun/core'
import type { Friend, FriendSuggestion, Conversation, StockPick, ExtractCtx } from '@nianlun/core'
import { analyzeStocks as runAnalyzeStocks, isFinanceRole } from '../adapters/stockAnalysis'
```

`Deps` 类型加一项：

```ts
type Deps = {
  useData?: ReturnType<typeof createDataStore>
  storage?: ReturnType<typeof makeStorage>
  suggest?: (f: Friend, s: string[]) => Promise<FriendSuggestion>
  loadSamples?: (id: string) => string[]
  extractStocks?: (f: Friend, samples: string[], ctx: ExtractCtx) => Promise<StockPick[]>  // ← 新增
}
```

`createImportStore` 内解析默认：

```ts
  const extractStocks = deps.extractStocks ?? aiClient.extractStocks
```

在 `defineStore` 回调内、`rawSavedCount` 附近加 refs：

```ts
    const analyzingStocks = ref<{ done: number; total: number } | null>(null)
    const stocksSavedCount = ref(0)
```

加统计文案与 action（放在 `analyzePendingRoles` 之后）：

```ts
    function stocksWarn(r: { analyzed: number; withPicks: number; failed: number; firstError?: string }): string {
      const parts = [`已从 ${r.analyzed} 位好友抽取荐股，${r.withPicks} 位有结果`]
      if (r.failed) parts.push(`${r.failed} 位失败${r.firstError ? '：' + r.firstError : ''}`)
      return parts.join('；')
    }

    /** 读回本机留存原文 → 对金融候选好友抽取荐股 → 持久化。重入保护。 */
    async function analyzeStocks(): Promise<void> {
      if (analyzingStocks.value) return
      try {
        const raw = storage.loadRawFiles()
        if (!raw.length) {
          warnings.value = [...warnings.value, '未找到留存原文，无法分析荐股。']
          return
        }
        let convs: Conversation[] = []
        for (const f of raw) convs = mergeConversations(convs, parseFile(f.name, f.content).conversations)
        const d = useData()
        const candCount = d.friends.filter(isFinanceRole).length
        analyzingStocks.value = { done: 0, total: candCount }   // await 前置位守卫
        const result = await runAnalyzeStocks({
          conversations: convs,
          friends: d.friends,
          extract: extractStocks,
          onProgress: (done, total) => { analyzingStocks.value = { done, total } },
        })
        storage.saveStockPicks(result.picks)
        stocksSavedCount.value = result.picks.length
        warnings.value = [...warnings.value, stocksWarn(result)]
      } catch (e) {
        warnings.value = [...warnings.value, `荐股分析未完成：${(e as Error).message}`]
      } finally {
        analyzingStocks.value = null
      }
    }
```

`reset()` 追加清零：

```ts
    function reset() { status.value = 'idle'; progress.value = 0; warnings.value = []; error.value = ''; analyzing.value = null; rawSavedCount.value = 0; analyzingStocks.value = null; stocksSavedCount.value = 0 }
```

`return { ... }` 追加导出：

```ts
    return { status, progress, warnings, error, analyzing, rawSavedCount, analyzingStocks, stocksSavedCount, run, analyzePendingRoles, analyzeStocks, reset }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/import.test.ts`
Expected: PASS

- [ ] **Step 5: 接线导入页按钮**

在 `import.vue` `<script setup>` 加处理函数（`onImport` 之后）：

```ts
async function onAnalyzeStocks() {
  await imp.analyzeStocks()
  uni.showToast({ title: imp.stocksSavedCount ? `已抽取荐股 ${imp.stocksSavedCount} 条` : '未抽到荐股', icon: 'none' })
}
```

在模板 `status.ok` 区块之后、`analyzing` 提示附近加按钮与进度：

```html
      <button
        v-if="imp.status === 'done' && imp.rawSavedCount"
        class="btn-primary" hover-class="hover" style="margin-top:20rpx"
        :disabled="!!imp.analyzingStocks" @click="onAnalyzeStocks">
        分析荐股
      </button>
      <view v-if="imp.analyzingStocks" class="status">
        <text class="status-t muted">正在分析荐股… {{ imp.analyzingStocks.done }}/{{ imp.analyzingStocks.total }}</text>
      </view>
      <view v-else-if="imp.stocksSavedCount" class="status ok">
        <text>✅ 已抽取荐股 {{ imp.stocksSavedCount }} 条</text>
      </view>
```

- [ ] **Step 6: 类型检查 + 全量测试**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: PASS（全部 miniapp 测试）

- [ ] **Step 7: 提交**

```bash
git add packages/miniapp/src/stores/import.ts packages/miniapp/src/stores/__tests__/import.test.ts packages/miniapp/src/pages/import/import.vue
git commit -m "feat(miniapp): 导入页「分析荐股」按钮 + import store analyzeStocks"
```

---

## 收尾验证

- [ ] Run: `pnpm -r test`
      Expected: core 与 miniapp 全绿。
- [ ] Run: `pnpm --filter @nianlun/core build`
      Expected: 成功（miniapp 依赖其 dist）。

## 全局自查记录

- **Spec 覆盖**：数据模型(Task 1) · parse(Task 2) · merge(Task 3) · 视图A/B(Task 4/5) · prompt(Task 6) · 导出(Task 7) · 存储(Task 8) · aiClient(Task 9) · 编排+分块+金融判定(Task 10) · 按钮+编排接线(Task 11)。现价字段在 Task 1 预留、全程不取数（符合 spec 非目标）。UI 视图（两个交叉视图页面）不在本 plan（spec 明确划到后续）。
- **命名一致**：`StockPick`/`ExtractCtx`/`StockCard`/`RecommenderPicks`、`normalizeStockName`/`parseStockExtraction`/`mergeStockPicks`/`aggregateByStock`/`aggregateByRecommender`/`buildStockExtractionPrompt`、`extractStocks`、`analyzeStocks`/`isFinanceRole`、`saveStockPicks`/`loadStockPicks`/`clearStockPicks` 在各任务间一致。
- **依赖边界**：core 仅用 `Date.UTC`（ES2020，允许）；`new Date(ts)` 的本地日期渲染只在 miniapp 层（`stockAnalysis.ts`），不入 core。
