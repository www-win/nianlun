# 二级市场 tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立「二级市场」tab（替换关系网），集「触发分析 + 以票查人 / 以人查票两个视图」于一处，让荐股功能可用。

**Architecture:** 页面从 `storage.loadStockPicks()` 读荐股原子记录，用 core 现成的 `aggregateByStock`/`aggregateByRecommender` 现场派生两个视图；排序/统计纯逻辑下沉到 `lib/stockView.ts`（可测）。分析触发复用 `importStore.analyzeStocks(files)`。不改导入模块、不改荐股引擎、不新增 store。

**Tech Stack:** uni-app（Vue 3 `<script setup>`）、Pinia、Vitest、`@nianlun/core`。

## Global Constraints

- **不改导入模块 / 不改荐股抽取引擎**：只加查看层。复用 `importStore.analyzeStocks`、`storage.loadStockPicks`、core 的 `aggregateByStock`/`aggregateByRecommender`。
- **视觉**：复用现有设计令牌（`--surface`/`--surface-2`/`--fg`/`--muted`/`--faint`/`--border`/`--border-2`/`--bg`/`--accent`/`--accent-wash`/`--accent-strong`/`--accent-line`）与 `pages/friends/friends.vue` 的 `.page`/`.card`/`.chip`/`.empty` 范式；三层卡片对齐 `docs/二级市场模块-功能示意图.html` 的 layer 样式。
- **导航**：`uni.navigateTo`；tab 用 `pages.json` 注册。
- **wx** 全局只在函数体内引用。
- **命令**：`pnpm --filter @nianlun/miniapp exec vitest run <file>`；最后 `pnpm --filter @nianlun/miniapp test` 全绿 + `build:mp-weixin`。
- **提交尾注**：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## 文件结构

- Create `packages/miniapp/src/lib/stockView.ts` — 排序/统计纯逻辑
- Create `packages/miniapp/src/lib/__tests__/stockView.test.ts`
- Modify `packages/miniapp/src/pages.json` — 换 tab（删 network、加 stock + stock-detail）
- Delete `packages/miniapp/src/pages/network/network.vue`
- Create `packages/miniapp/src/pages/stock/stock.vue` — 主页（两视图列表 + 空态 + 分析触发）
- Create `packages/miniapp/src/pages/stock-detail/stock-detail.vue` — 票/人详情
- Modify `packages/miniapp/src/pages/import/import.vue` — 移除「分析荐股」按钮

---

## Task 1: `lib/stockView.ts` 排序/统计纯逻辑

**Files:**
- Create: `packages/miniapp/src/lib/stockView.ts`
- Test: `packages/miniapp/src/lib/__tests__/stockView.test.ts`

**Interfaces:**
- Consumes: `StockPick`/`StockCard`/`RecommenderPicks`（`@nianlun/core`）。
- Produces: `sortStockCards(cards): StockCard[]`、`sortRecommenders(rs): RecommenderPicks[]`、`stockStats(picks): { pickCount; stockCount; personCount }`。

- [ ] **Step 1: 写失败测试**

创建 `packages/miniapp/src/lib/__tests__/stockView.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { sortStockCards, sortRecommenders, stockStats } from '../stockView'
import type { StockCard, RecommenderPicks, StockPick } from '@nianlun/core'

const card = (norm: string, rc: number, pc: number): StockCard => ({
  stockNorm: norm, displayName: norm, recommenderCount: rc, pickCount: pc,
  logics: [], companyNotes: [], picks: [],
})
const rp = (id: string, sc: number, pn: number): RecommenderPicks => ({
  recommenderId: id, recommender: id, stockCount: sc,
  picks: Array.from({ length: pn }, () => ({} as StockPick)),
})
const pick = (stockNorm: string, rid: string): StockPick => ({
  stock: stockNorm, stockNorm, recommenderId: rid, recommender: rid, ts: 0, logics: [], companyNotes: [],
})

describe('sortStockCards', () => {
  it('按 recommenderCount 降序，tie 用 pickCount', () => {
    const out = sortStockCards([card('A', 1, 9), card('B', 3, 1), card('C', 3, 5)])
    expect(out.map((c) => c.stockNorm)).toEqual(['C', 'B', 'A'])  // B/C 同 rc=3，C pickCount 大在前
  })
})
describe('sortRecommenders', () => {
  it('按 stockCount 降序', () => {
    const out = sortRecommenders([rp('a', 1, 1), rp('b', 4, 1)])
    expect(out.map((r) => r.recommenderId)).toEqual(['b', 'a'])
  })
})
describe('stockStats', () => {
  it('统计条数 / 不同票数 / 不同人数', () => {
    const s = stockStats([pick('A', 'x'), pick('A', 'y'), pick('B', 'x')])
    expect(s).toEqual({ pickCount: 3, stockCount: 2, personCount: 2 })
  })
  it('空 → 全 0', () => {
    expect(stockStats([])).toEqual({ pickCount: 0, stockCount: 0, personCount: 0 })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/stockView.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

创建 `packages/miniapp/src/lib/stockView.ts`：

```ts
import type { StockPick, StockCard, RecommenderPicks } from '@nianlun/core'

/** 视图A 票列表排序：推的人越多越靠前（核心标的），并列时荐股条数多的在前。 */
export function sortStockCards(cards: StockCard[]): StockCard[] {
  return [...cards].sort((a, b) => b.recommenderCount - a.recommenderCount || b.pickCount - a.pickCount)
}

/** 视图B 人列表排序：推过的票越多越靠前，并列时荐股条数多的在前。 */
export function sortRecommenders(rs: RecommenderPicks[]): RecommenderPicks[] {
  return [...rs].sort((a, b) => b.stockCount - a.stockCount || b.picks.length - a.picks.length)
}

/** 顶部统计：荐股条数、不同票数、不同推荐人数。 */
export function stockStats(picks: StockPick[]): { pickCount: number; stockCount: number; personCount: number } {
  return {
    pickCount: picks.length,
    stockCount: new Set(picks.map((p) => p.stockNorm)).size,
    personCount: new Set(picks.map((p) => p.recommenderId)).size,
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/stockView.test.ts`
Expected: PASS（4 用例）

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/lib/stockView.ts packages/miniapp/src/lib/__tests__/stockView.test.ts
git commit -m "feat(miniapp): stockView 荐股视图排序/统计纯逻辑"
```

---

## Task 2: `pages.json` 换 tab + 删关系网

**Files:**
- Modify: `packages/miniapp/src/pages.json`
- Delete: `packages/miniapp/src/pages/network/network.vue`

**Interfaces:**
- Produces: tabBar 第 4 项从「关系网」变「二级市场」（`pages/stock/stock`）；新增 `pages/stock-detail/stock-detail` page（非 tab）。

- [ ] **Step 1: 改 pages.json**

`pages` 数组里，把 `{ "path": "pages/network/network", ... }` 那行替换为两行：

```json
    { "path": "pages/stock/stock", "style": { "navigationBarTitleText": "二级市场" } },
    { "path": "pages/stock-detail/stock-detail", "style": { "navigationBarTitleText": "荐股详情" } },
```

`tabBar.list` 里，把 `{ "pagePath": "pages/network/network", "text": "关系网" }` 替换为：

```json
      { "pagePath": "pages/stock/stock", "text": "二级市场" },
```

- [ ] **Step 2: 删除关系网页**

删除文件 `packages/miniapp/src/pages/network/network.vue`。（grep 已确认无其它页面跳转它；`lib/egoLayout.ts` 及其测试保留，无害。）

```bash
git rm packages/miniapp/src/pages/network/network.vue
```

- [ ] **Step 3: 全量测试确认无回归**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: PASS（删 network 不影响任何测试；egoLayout 测试仍在、仍绿）

- [ ] **Step 4: 提交**

```bash
git add packages/miniapp/src/pages.json
git commit -m "feat(miniapp): tabBar 关系网换成二级市场 + 注册荐股详情页"
```

---

## Task 3: 主页 `pages/stock/stock.vue`

**Files:**
- Create: `packages/miniapp/src/pages/stock/stock.vue`

**Interfaces:**
- Consumes: `storage.loadStockPicks()`、`aggregateByStock`/`aggregateByRecommender`（core）、`sortStockCards`/`sortRecommenders`/`stockStats`（Task 1）、`importStore.analyzeStocks`/`analyzingStocks`/`stocksSavedCount`、`fileReader.pickAndRead`。
- Produces: 「二级市场」tab 主页（两视图列表 + 空态 + 分析触发）。

- [ ] **Step 1: 写页面**

创建 `packages/miniapp/src/pages/stock/stock.vue`。`<script setup>`：

```ts
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { storage } from '../../adapters/storage'
import { useImportStore } from '../../stores/import'
import { fileReader } from '../../adapters/fileReader'
import { aggregateByStock, aggregateByRecommender } from '@nianlun/core'
import type { StockPick } from '@nianlun/core'
import { sortStockCards, sortRecommenders, stockStats } from '../../lib/stockView'

const imp = useImportStore()
const picks = ref<StockPick[]>([])
const tab = ref<'stock' | 'person'>('stock')

function reload() { picks.value = storage.loadStockPicks() }
onShow(() => reload())   // 每次进 tab 刷新（分析/别处更新后同步）

const stats = computed(() => stockStats(picks.value))
const cards = computed(() => sortStockCards(aggregateByStock(picks.value)))
const people = computed(() => sortRecommenders(aggregateByRecommender(picks.value)))

async function onAnalyze() {
  try {
    const files = await fileReader.pickAndRead(500)
    if (!files.length) return
    await imp.analyzeStocks(files)
    reload()
    uni.showToast({ title: imp.stocksSavedCount ? `已抽取荐股 ${imp.stocksSavedCount} 条` : '未抽到荐股', icon: 'none' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '分析失败', icon: 'none' })
  }
}

function openStock(stockNorm: string) {
  uni.navigateTo({ url: `/pages/stock-detail/stock-detail?type=stock&key=${encodeURIComponent(stockNorm)}` })
}
function openPerson(id: string) {
  uni.navigateTo({ url: `/pages/stock-detail/stock-detail?type=person&id=${encodeURIComponent(id)}` })
}
```

`<template>`：

```html
<template>
  <view class="page">
    <view class="head">
      <button class="btn-primary" :disabled="!!imp.analyzingStocks" @click="onAnalyze">
        {{ imp.analyzingStocks ? `分析中… ${imp.analyzingStocks.done}/${imp.analyzingStocks.total}` : '分析荐股（选聊天文件）' }}
      </button>
      <text class="hint faint">只分析所选文件里的好友</text>
      <view v-if="stats.pickCount" class="stats">
        已抽 {{ stats.pickCount }} 条 · {{ stats.stockCount }} 支票 · {{ stats.personCount }} 人
      </view>
    </view>

    <view v-if="!stats.pickCount" class="empty">
      <view class="e-icon">📈</view>
      <view class="e-text">还没有荐股数据。点上方「分析荐股」，选聊天文件抽取一次。</view>
    </view>

    <template v-else>
      <view class="chips">
        <text class="chip" :class="{ on: tab === 'stock' }" @click="tab = 'stock'">以票查人</text>
        <text class="chip" :class="{ on: tab === 'person' }" @click="tab = 'person'">以人查票</text>
      </view>

      <!-- 视图A：以票查人 -->
      <template v-if="tab === 'stock'">
        <view v-for="c in cards" :key="c.stockNorm" class="card srow" @click="openStock(c.stockNorm)">
          <view class="info">
            <text class="name">{{ c.displayName }}</text>
            <view class="meta">
              <view class="badge">{{ c.recommenderCount }} 人在推</view>
              <text v-if="c.latestMultiple" class="mu">看 {{ c.latestMultiple }}</text>
              <text v-if="c.latestTargetMarketCap" class="mu">目标 {{ c.latestTargetMarketCap }}</text>
            </view>
          </view>
          <text class="chevron">›</text>
        </view>
      </template>

      <!-- 视图B：以人查票 -->
      <template v-else>
        <view v-for="p in people" :key="p.recommenderId" class="card srow" @click="openPerson(p.recommenderId)">
          <view class="info">
            <text class="name">{{ p.recommender }}</text>
            <view class="meta"><text class="mu">推过 {{ p.stockCount }} 支票</text></view>
          </view>
          <text class="chevron">›</text>
        </view>
      </template>
    </template>
  </view>
</template>
```

`<style scoped>`：复用 friends.vue 的令牌与范式。至少包含 `.page`（`padding: 32rpx 28rpx 64rpx`）、`.empty`/`.e-icon`/`.e-text`、`.chips`/`.chip`/`.chip.on`（照抄 friends.vue）、`.card`（`background: var(--surface); border: 1rpx solid var(--border); border-radius: 20rpx`）、`.srow`（`display: flex; align-items: center; padding: 28rpx; margin-bottom: 20rpx`）、`.info`（`flex: 1`）、`.name`/`.meta`/`.mu`/`.chevron`（照 friends.vue）、`.badge`（`padding: 4rpx 16rpx; border-radius: 999rpx; font-size: 22rpx; background: var(--accent-wash); color: var(--accent-strong); font-weight: 600`）、`.head`/`.btn-primary`/`.hint`/`.stats`。

- [ ] **Step 2: 类型检查 + 全量测试（页面无单测，确保编译/无回归）**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/miniapp/src/pages/stock/stock.vue
git commit -m "feat(miniapp): 二级市场主页(以票查人/以人查票 + 分析触发 + 空态)"
```

---

## Task 4: 详情页 `pages/stock-detail/stock-detail.vue`

**Files:**
- Create: `packages/miniapp/src/pages/stock-detail/stock-detail.vue`

**Interfaces:**
- Consumes: `storage.loadStockPicks()`、`aggregateByStock`/`aggregateByRecommender`（core）、query `type`/`key`/`id`。
- Produces: 票详情（三层卡片 + 推荐记录）/ 人详情（推过的票列表）。

- [ ] **Step 1: 写页面**

创建 `packages/miniapp/src/pages/stock-detail/stock-detail.vue`。`<script setup>`：

```ts
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { storage } from '../../adapters/storage'
import { aggregateByStock, aggregateByRecommender } from '@nianlun/core'
import type { StockCard, RecommenderPicks, StockPick } from '@nianlun/core'

const kind = ref<'stock' | 'person'>('stock')
const card = ref<StockCard | null>(null)      // 票详情
const person = ref<RecommenderPicks | null>(null)  // 人详情

/** 该票按推荐时间倒序的记录（推荐人 · 时间 · 倍数 · 原话）。 */
const picksSorted = ref<StockPick[]>([])

function fmtDate(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n: number) => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

onLoad((q?: Record<string, string>) => {
  const picks = storage.loadStockPicks()
  if (q?.type === 'person') {
    kind.value = 'person'
    const id = decodeURIComponent(q.id || '')
    person.value = aggregateByRecommender(picks).find((r) => r.recommenderId === id) ?? null
    picksSorted.value = [...(person.value?.picks ?? [])].sort((a, b) => b.ts - a.ts)
  } else {
    kind.value = 'stock'
    const key = decodeURIComponent(q?.key || '')
    card.value = aggregateByStock(picks).find((c) => c.stockNorm === key) ?? null
    picksSorted.value = [...(card.value?.picks ?? [])].sort((a, b) => b.ts - a.ts)
  }
})
```

`<template>`（票详情三层卡片对齐功能示意图 layer 样式；人详情为票列表）：

```html
<template>
  <view class="page">
    <!-- 票详情 -->
    <template v-if="kind === 'stock' && card">
      <view class="title">{{ card.displayName }}</view>
      <!-- 第一层·基本盘 -->
      <view class="layer">
        <view class="l-h"><text class="no">1</text><text class="l-t">基本盘</text></view>
        <view class="kv"><text class="k">被谁推</text><text class="v">{{ card.recommenderCount }} 人</text></view>
        <view class="kv"><text class="k">目标市值</text><text class="v">{{ card.latestTargetMarketCap || '—' }}</text></view>
        <view class="kv"><text class="k">涨幅倍数</text><text class="v">{{ card.latestMultiple || '—' }}</text></view>
        <view class="kv"><text class="k">现价</text><text class="v">—（数据源待接）</text></view>
      </view>
      <!-- 第二层·推荐逻辑 -->
      <view class="layer">
        <view class="l-h"><text class="no">2</text><text class="l-t">推荐逻辑</text></view>
        <view v-if="card.logics.length" v-for="(l, i) in card.logics" :key="i" class="bullet">· {{ l }}</view>
        <text v-else class="faint">暂无</text>
      </view>
      <!-- 第三层·公司信息 -->
      <view class="layer">
        <view class="l-h"><text class="no">3</text><text class="l-t">公司信息 · 谁说了啥</text></view>
        <view v-if="card.companyNotes.length" v-for="(n, i) in card.companyNotes" :key="i" class="bullet">· {{ n }}</view>
        <text v-else class="faint">暂无</text>
      </view>
      <!-- 推荐记录 -->
      <view class="sec-h">推荐记录</view>
      <view v-for="(p, i) in picksSorted" :key="i" class="card rec">
        <view class="rec-top"><text class="rec-who">{{ p.recommender }}</text><text class="faint">{{ fmtDate(p.ts) }}</text></view>
        <view class="rec-meta">
          <text v-if="p.multiple" class="mu">看 {{ p.multiple }}</text>
          <text v-if="p.targetMarketCap" class="mu">目标 {{ p.targetMarketCap }}</text>
        </view>
        <text v-if="p.quote" class="quote">「{{ p.quote }}」</text>
      </view>
    </template>

    <!-- 人详情 -->
    <template v-else-if="kind === 'person' && person">
      <view class="title">{{ person.recommender }}</view>
      <text class="sub faint">推过 {{ person.stockCount }} 支票</text>
      <view v-for="(p, i) in picksSorted" :key="i" class="card rec">
        <view class="rec-top"><text class="rec-who">{{ p.stock }}</text><text class="faint">{{ fmtDate(p.ts) }}</text></view>
        <view class="rec-meta">
          <text v-if="p.multiple" class="mu">看 {{ p.multiple }}</text>
          <text v-if="p.targetMarketCap" class="mu">目标 {{ p.targetMarketCap }}</text>
        </view>
        <text v-if="p.quote" class="quote">「{{ p.quote }}」</text>
      </view>
    </template>

    <view v-else class="empty"><view class="e-text">未找到该记录</view></view>
  </view>
</template>
```

`<style scoped>`：复用令牌。`.page`（padding 同 friends）、`.title`（`font-size: 40rpx; font-weight: 700; color: var(--fg); margin-bottom: 20rpx`）、`.layer`（`background: var(--surface); border: 1rpx solid var(--border); border-left: 6rpx solid var(--accent); border-radius: 16rpx; padding: 22rpx; margin-bottom: 18rpx`，对齐示意图 layer）、`.l-h`/`.no`（绿底圆序号）/`.l-t`、`.kv`（flex space-between）、`.bullet`、`.sec-h`、`.card.rec`、`.rec-top`/`.rec-who`/`.rec-meta`/`.mu`/`.quote`（`color: var(--muted); font-size: 24rpx`）、`.faint`、`.empty`/`.e-text`。

- [ ] **Step 2: 类型检查 + 全量测试**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/miniapp/src/pages/stock-detail/stock-detail.vue
git commit -m "feat(miniapp): 荐股详情页(票三层卡片+推荐记录 / 人的票列表)"
```

---

## Task 5: 导入页移除「分析荐股」按钮

**Files:**
- Modify: `packages/miniapp/src/pages/import/import.vue`

**Interfaces:**
- Consumes: 无（纯删除）。触发已迁至二级市场 tab。

- [ ] **Step 1: 移除按钮与处理函数**

在 `import.vue` 中删除：
- 模板里的「分析荐股（重新选文件）」`<button>` 及其下方 `analyzingStocks` 进度 view、`stocksSavedCount` 结果 view。
- `<script setup>` 里的 `onAnalyzeStocks` 函数。

（`importStore.analyzeStocks` action 保留不动——二级市场 tab 在用。）

- [ ] **Step 2: 类型检查 + 全量测试**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: PASS（`import.test.ts` 测的是 store，不测按钮，仍绿）

- [ ] **Step 3: 提交**

```bash
git add packages/miniapp/src/pages/import/import.vue
git commit -m "feat(miniapp): 导入页移除分析荐股按钮(已迁二级市场 tab)"
```

---

## 收尾验证

- [ ] Run: `pnpm --filter @nianlun/miniapp test` → 全绿
- [ ] Run: `pnpm --filter @nianlun/miniapp build:mp-weixin` → 成功
- [ ] 真机验收：底部「二级市场」tab → 进去空态 → 点「分析荐股」选文件 → 抽完看到票列表/人列表 → 点票看三层卡片、点人看其票。

## 全局自查记录

- **Spec 覆盖**：入口(Task2) · 主页两视图+空态+触发(Task3) · 票/人详情三层(Task4) · 导入移按钮(Task5) · 排序统计(Task1)。选好友靠选文件（Task3 提示文案）。现价占位(Task4)。
- **命名一致**：`sortStockCards`/`sortRecommenders`/`stockStats`、query `type`/`key`/`id`、`aggregateByStock`/`aggregateByRecommender` 在各任务间一致。
- **不改引擎/导入存储**：仅复用 `analyzeStocks`/`loadStockPicks`/core 聚合函数。
