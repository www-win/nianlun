# 关系网（Ego Relationship Graph）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个「关系网」页面，以用户本人为圆心、所有好友为环绕节点，用 SVG 星状图展示关系全貌，支持按关系筛选、搜索高亮、点节点看详情。

**Architecture:** core 新增纯函数 `buildEgoGraph(friends)` 输出归一化布局坐标（不碰颜色/像素/DOM）；web 把归一化坐标映射成 SVG 像素并套关系配色，复用好友页已有的抽屉、筛选 chip、搜索、配色等模式。遵守 `@nianlun/web → @nianlun/core` 单向依赖与「core 算、web 显示」铁律。

**Tech Stack:** TypeScript（core 纯逻辑库，`lib: ES2020`、无 DOM 类型）、Vue 3 `<script setup>`、Pinia、vue-router、vitest（core 直跑 / web 用 jsdom + @vue/test-utils）。

## Global Constraints

- **单向依赖**：`core` 永不 import `web`，永不触碰 `window`/`document`/`IndexedDB`/`vue`。布局函数必须是纯函数。
- **确定性**：`buildEgoGraph` 同输入同输出；不得使用随机数或 `Date.now()`。
- **Relation 类型**：恰为 `'家人' | '挚友' | '同事' | '同学' | '客户' | '其他'`，从 `@nianlun/core` import，绝不重定义。
- **编辑铁律**：关系网页详情只读；任何好友编辑仍只经好友页的 `data.updateFriend`。
- **包管理**：使用 pnpm，不用 npm/yarn。
- **关系配色**（沿用好友页，单一来源）：
  - 家人 `oklch(60% 0.12 25)`、挚友 `oklch(62% 0.12 145)`、同事 `oklch(58% 0.1 250)`、同学 `oklch(66% 0.13 75)`、客户 `oklch(58% 0.11 320)`、其他 `oklch(60% 0.02 240)`。

---

### Task 1: core `buildEgoGraph` 纯函数

**Files:**
- Create: `packages/core/src/stats/egoGraph.ts`
- Test: `packages/core/src/stats/__tests__/egoGraph.test.ts`
- Modify: `packages/core/src/index.ts`（新增导出）

**Interfaces:**
- Consumes: `Friend`、`Relation`（来自 `../model/types`）。
- Produces:
  - `export interface EgoNode { id: string; name: string; rel: Relation; angle: number; radiusFraction: number; sizeFraction: number; msgCount: number }`
  - `export interface EgoGraph { nodes: EgoNode[] }`
  - `export function buildEgoGraph(friends: Friend[]): EgoGraph`
  - 语义：`angle` 弧度；`radiusFraction` 0–1（0=圆心，1=最外圈，消息越多越靠近圆心）；`sizeFraction` 0–1（消息越多越大）。

- [ ] **Step 1: Write the failing test**

创建 `packages/core/src/stats/__tests__/egoGraph.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { buildEgoGraph } from '../egoGraph'
import { createFriend } from '../../model/friend'
import type { Friend } from '../../model/types'

function f(id: string, rel: Friend['rel'], msgCount: number): Friend {
  const x = createFriend(id, id)
  x.rel = rel
  x.msgCount = msgCount
  return x
}

describe('buildEgoGraph', () => {
  it('returns no nodes for empty input', () => {
    expect(buildEgoGraph([]).nodes).toEqual([])
  })

  it('produces one node per friend', () => {
    const g = buildEgoGraph([f('a', '家人', 10), f('b', '同事', 20)])
    expect(g.nodes.length).toBe(2)
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
  })

  it('places the most-messaged friend closest to centre and largest', () => {
    const g = buildEgoGraph([f('hi', '挚友', 1000), f('lo', '挚友', 10)])
    const hi = g.nodes.find((n) => n.id === 'hi')!
    const lo = g.nodes.find((n) => n.id === 'lo')!
    expect(hi.radiusFraction).toBeCloseTo(0.25)   // R_MIN
    expect(hi.sizeFraction).toBeCloseTo(1)
    expect(hi.radiusFraction).toBeLessThan(lo.radiusFraction)
    expect(hi.sizeFraction).toBeGreaterThan(lo.sizeFraction)
  })

  it('gives a larger angular sector to relations with more members', () => {
    const friends = [
      f('f1', '家人', 4), f('f2', '家人', 3), f('f3', '家人', 2), f('f4', '家人', 1),
      f('w1', '同事', 4), f('w2', '同事', 3),
    ]
    const g = buildEgoGraph(friends)
    const extent = (rel: string) => {
      const a = g.nodes.filter((n) => n.rel === rel).map((n) => n.angle)
      return Math.max(...a) - Math.min(...a)
    }
    expect(extent('家人')).toBeGreaterThan(extent('同事'))
  })

  it('is deterministic', () => {
    const make = () => [f('a', '家人', 10), f('b', '同事', 20), f('c', '同学', 5)]
    expect(buildEgoGraph(make())).toEqual(buildEgoGraph(make()))
  })

  it('does not divide by zero when every friend has zero messages', () => {
    const g = buildEgoGraph([f('a', '家人', 0), f('b', '同事', 0)])
    for (const n of g.nodes) {
      expect(Number.isFinite(n.radiusFraction)).toBe(true)
      expect(Number.isFinite(n.sizeFraction)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @nianlun/core exec vitest run src/stats/__tests__/egoGraph.test.ts`
Expected: FAIL（`buildEgoGraph` 模块不存在 / 无法解析 `../egoGraph`）。

- [ ] **Step 3: Write minimal implementation**

创建 `packages/core/src/stats/egoGraph.ts`：

```ts
import type { Friend, Relation } from '../model/types'

export interface EgoNode {
  id: string
  name: string
  rel: Relation
  angle: number           // 弧度
  radiusFraction: number  // 0–1，0=圆心，1=最外圈
  sizeFraction: number    // 0–1，节点相对大小
  msgCount: number
}

export interface EgoGraph {
  nodes: EgoNode[]
}

const REL_ORDER: Relation[] = ['家人', '挚友', '同事', '同学', '客户', '其他']
const TWO_PI = Math.PI * 2
const R_MIN = 0.25   // 联系最密 → 最靠近圆心
const R_MAX = 1
const SIZE_MIN = 0.35

export function buildEgoGraph(friends: Friend[]): EgoGraph {
  if (friends.length === 0) return { nodes: [] }

  const maxMsg = Math.max(...friends.map((f) => f.msgCount), 1)

  // 1) 按关系分组，仅保留非空组，按固定顺序
  const groups = REL_ORDER
    .map((rel) => ({ rel, members: friends.filter((f) => f.rel === rel) }))
    .filter((g) => g.members.length > 0)

  // 2) 加性平滑分配扇区角度：weight = count + 1，保证单人组也有非零扇区
  const weights = groups.map((g) => g.members.length + 1)
  const weightSum = weights.reduce((a, b) => a + b, 0)

  const nodes: EgoNode[] = []
  let angleCursor = 0
  groups.forEach((g, gi) => {
    const span = (weights[gi] / weightSum) * TWO_PI
    const ordered = [...g.members].sort((a, b) => b.msgCount - a.msgCount)
    const n = ordered.length
    ordered.forEach((fr, i) => {
      const angle = angleCursor + span * ((i + 0.5) / n)
      const norm = fr.msgCount / maxMsg   // 0..1
      nodes.push({
        id: fr.id,
        name: fr.name,
        rel: fr.rel,
        angle,
        radiusFraction: R_MAX - norm * (R_MAX - R_MIN),
        sizeFraction: SIZE_MIN + norm * (1 - SIZE_MIN),
        msgCount: fr.msgCount,
      })
    })
    angleCursor += span
  })

  return { nodes }
}
```

- [ ] **Step 4: Add the export**

修改 `packages/core/src/index.ts`，在 `buildReport` 导出行之后新增：

```ts
export { buildEgoGraph } from './stats/egoGraph'
export type { EgoNode, EgoGraph } from './stats/egoGraph'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @nianlun/core exec vitest run src/stats/__tests__/egoGraph.test.ts`
Expected: PASS（6 个测试全过）。

- [ ] **Step 6: Build core so web can consume it**

Run: `pnpm --filter @nianlun/core build`
Expected: tsup 成功输出 `dist/`，无 TS 报错（验证未触碰 DOM 类型）。

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/stats/egoGraph.ts packages/core/src/stats/__tests__/egoGraph.test.ts packages/core/src/index.ts
git commit -m "feat(core): add buildEgoGraph for relationship-graph layout"
```

---

### Task 2: web 共享关系展示工具 `lib/relations.ts`

把好友页内联的关系配色 / 工具抽成单一来源，供好友页与关系网页共用。**仅限颜色与关系展示工具，不动好友页其他逻辑。**

**Files:**
- Create: `packages/web/src/lib/relations.ts`
- Test: `packages/web/src/lib/__tests__/relations.test.ts`
- Modify: `packages/web/src/pages/FriendsPage.vue`（删除本地定义，改为 import）

**Interfaces:**
- Consumes: `Relation`（来自 `@nianlun/core`）。
- Produces:
  - `export const RELATIONS: Relation[]`
  - `export const REL_COLORS: Record<string, string>`
  - `export function relColor(rel: string): string`
  - `export function initials(name: string): string`

- [ ] **Step 1: Write the failing test**

创建 `packages/web/src/lib/__tests__/relations.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { RELATIONS, REL_COLORS, relColor, initials } from '../relations'

describe('relations lib', () => {
  it('lists the six relations in order', () => {
    expect(RELATIONS).toEqual(['家人', '挚友', '同事', '同学', '客户', '其他'])
  })

  it('maps every relation to a colour', () => {
    for (const r of RELATIONS) expect(typeof REL_COLORS[r]).toBe('string')
  })

  it('relColor falls back for unknown relations', () => {
    expect(relColor('挚友')).toBe(REL_COLORS['挚友'])
    expect(relColor('不存在')).toBe('oklch(60% 0.02 240)')
  })

  it('initials takes the last two characters', () => {
    expect(initials('周彤')).toBe('周彤')
    expect(initials('陈志远')).toBe('志远')
    expect(initials('王')).toBe('王')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @nianlun/web exec vitest run src/lib/__tests__/relations.test.ts`
Expected: FAIL（无法解析 `../relations`）。

- [ ] **Step 3: Write the implementation**

创建 `packages/web/src/lib/relations.ts`：

```ts
import type { Relation } from '@nianlun/core'

export const RELATIONS: Relation[] = ['家人', '挚友', '同事', '同学', '客户', '其他']

export const REL_COLORS: Record<string, string> = {
  '家人': 'oklch(60% 0.12 25)',
  '挚友': 'oklch(62% 0.12 145)',
  '同事': 'oklch(58% 0.1 250)',
  '同学': 'oklch(66% 0.13 75)',
  '客户': 'oklch(58% 0.11 320)',
  '其他': 'oklch(60% 0.02 240)',
}

export function relColor(rel: string): string {
  return REL_COLORS[rel] || 'oklch(60% 0.02 240)'
}

export function initials(name: string): string {
  return name.slice(name.length > 1 ? name.length - 2 : 0)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @nianlun/web exec vitest run src/lib/__tests__/relations.test.ts`
Expected: PASS。

- [ ] **Step 5: Refactor FriendsPage to use the shared lib**

在 `packages/web/src/pages/FriendsPage.vue` 的 `<script setup>` 中：

1. 在已有 import 区新增（紧跟其他 import）：
```ts
import { RELATIONS, REL_COLORS, relColor, initials } from '../lib/relations'
```
2. **删除**这些原本内联的定义（它们已移入 lib）：
   - `const RELATIONS: Relation[] = ['家人', '挚友', '同事', '同学', '客户', '其他']`
   - 整块 `const REL_COLORS: Record<string, string> = { ... }`
   - `function initials(name: string) { ... }`
   - `function relColor(rel: string) { return REL_COLORS[rel] || 'oklch(60% 0.02 240)' }`
3. 若 `Relation` 在删除上述行后仍被其它代码（如 `relFilter`、`saveRel`）使用，则保留 `import type { Friend, Relation } from '@nianlun/core'`；否则去掉未使用的 `Relation` 以免 `vue-tsc` 报未使用。（实现时按实际编译结果决定。）

- [ ] **Step 6: Run FriendsPage tests + typecheck to verify no regression**

Run: `pnpm --filter @nianlun/web exec vitest run src/pages/__tests__/FriendsPage.test.ts`
Expected: PASS（3 个原有测试不变）。

Run: `pnpm --filter @nianlun/web build`
Expected: `vue-tsc --noEmit` 通过、`vite build` 成功（确认无未使用变量 / 类型错误）。

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/lib/relations.ts packages/web/src/lib/__tests__/relations.test.ts packages/web/src/pages/FriendsPage.vue
git commit -m "refactor(web): extract shared relation colours/utils to lib/relations"
```

---

### Task 3: web 关系网页面 `RelationGraphPage.vue` + 路由 + 导航

完整页面：SVG 星状图渲染 + 规模兜底 + 关系筛选 + 搜索高亮 + 点节点开只读详情抽屉。单文件内多轮 TDD，最后一次提交。

**Files:**
- Create: `packages/web/src/pages/RelationGraphPage.vue`
- Test: `packages/web/src/pages/__tests__/RelationGraphPage.test.ts`
- Modify: `packages/web/src/router/index.ts`（新增 `/graph` 路由）
- Modify: `packages/web/src/components/TheTopbar.vue`（导航新增「关系网」）

**Interfaces:**
- Consumes: `buildEgoGraph`、`EgoNode`、`Friend`、`Relation`（来自 `@nianlun/core`）；`RELATIONS`、`REL_COLORS`、`relColor`、`initials`（来自 `../lib/relations`）；`useDataStore`（`../stores/data`）。
- Produces: 路由名 `graph`、路径 `/graph`；导航链接 `to="/graph"`。
- DOM 契约（供测试依赖）：
  - 每个好友节点是一个 `<circle class="node">`，可附加 class `dimmed`（被筛选/搜索淡出）与 `hit`（搜索命中）。
  - 搜索框为 `<input type="search">`；关系筛选为若干 `<button class="chip">`。
  - 点击 `circle.node` 打开 `<aside class="drawer">`，加 class `open`。
  - 无数据时渲染指向 `/import` 的链接。

- [ ] **Step 1: Write the failing tests**

创建 `packages/web/src/pages/__tests__/RelationGraphPage.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import RelationGraphPage from '../RelationGraphPage.vue'
import { useDataStore } from '../../stores/data'
import { createFriend } from '@nianlun/core'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/import', '/friends', '/graph', '/report'].map((p) => ({ path: p, component: { template: '<div/>' } })),
  })
}

function seed() {
  const data = useDataStore()
  const a = createFriend('周彤', '周彤'); a.rel = '挚友'; a.msgCount = 9670
  const b = createFriend('陈志远', '陈志远'); b.rel = '同事'; b.msgCount = 12880
  const c = createFriend('王芳', '王芳'); c.rel = '家人'; c.msgCount = 300
  data.friends = [a, b, c]
  data.report = { year: 2025, totalMessages: 22850, friendCount: 3, activeDays: 100, topContacts: [], latestMessage: null, keywords: [], relationBreakdown: [] }
  return data
}

async function mountReady() {
  const router = makeRouter(); router.push('/graph'); await router.isReady()
  return mount(RelationGraphPage, { global: { plugins: [router] } })
}

describe('RelationGraphPage', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('shows an empty state linking to import when no data', async () => {
    const wrapper = await mountReady()
    expect(wrapper.text()).toMatch(/还没有数据|导入/)
    expect(wrapper.findAll('a').map((a) => a.attributes('href'))).toContain('/import')
  })

  it('renders one node circle per friend', async () => {
    seed()
    const wrapper = await mountReady()
    expect(wrapper.findAll('circle.node').length).toBe(3)
  })

  it('dims non-matching relations when a filter chip is chosen', async () => {
    seed()
    const wrapper = await mountReady()
    const chip = wrapper.findAll('button.chip').find((b) => b.text() === '同事')!
    await chip.trigger('click')
    // 仅「同事」一人不被淡出
    expect(wrapper.findAll('circle.node:not(.dimmed)').length).toBe(1)
  })

  it('highlights nodes that match the search box', async () => {
    seed()
    const wrapper = await mountReady()
    await wrapper.find('input[type="search"]').setValue('周彤')
    expect(wrapper.findAll('circle.node.hit').length).toBe(1)
  })

  it('opens a read-only detail drawer when a node is clicked', async () => {
    seed()
    const wrapper = await mountReady()
    await wrapper.find('circle.node').trigger('click')
    const drawer = wrapper.find('aside.drawer')
    expect(drawer.classes()).toContain('open')
    expect(drawer.text()).toMatch(/周彤|陈志远|王芳/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @nianlun/web exec vitest run src/pages/__tests__/RelationGraphPage.test.ts`
Expected: FAIL（无法解析 `../RelationGraphPage.vue`）。

- [ ] **Step 3: Write the page implementation**

创建 `packages/web/src/pages/RelationGraphPage.vue`：

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDataStore } from '../stores/data'
import { buildEgoGraph } from '@nianlun/core'
import type { Friend, Relation, EgoNode } from '@nianlun/core'
import { RELATIONS, relColor, initials } from '../lib/relations'
import TheTopbar from '../components/TheTopbar.vue'
import TheFooter from '../components/TheFooter.vue'

const data = useDataStore()
const router = useRouter()

// SVG 几何
const SIZE = 720
const CENTER = SIZE / 2
const R = SIZE / 2 - 70          // 最外圈像素半径
const R_NODE_MIN = 7
const R_NODE_MAX = 26
const LABEL_LIMIT = 150          // 超过则只给消息量 Top N 标名字

const q = ref('')
const relFilter = ref<'all' | Relation>('all')

interface PlacedNode extends EgoNode {
  x: number
  y: number
  r: number
  friend: Friend
  showLabel: boolean
}

const friendById = computed(() => {
  const m = new Map<string, Friend>()
  data.friends.forEach((f) => m.set(f.id, f))
  return m
})

const nodes = computed<PlacedNode[]>(() => {
  const g = buildEgoGraph(data.friends)
  const showAllLabels = g.nodes.length <= LABEL_LIMIT
  const labelIds = new Set(
    [...g.nodes].sort((a, b) => b.msgCount - a.msgCount).slice(0, LABEL_LIMIT).map((n) => n.id),
  )
  return g.nodes.map((n) => ({
    ...n,
    x: CENTER + Math.cos(n.angle) * n.radiusFraction * R,
    y: CENTER + Math.sin(n.angle) * n.radiusFraction * R,
    r: R_NODE_MIN + n.sizeFraction * (R_NODE_MAX - R_NODE_MIN),
    friend: friendById.value.get(n.id)!,
    showLabel: showAllLabels || labelIds.has(n.id),
  }))
})

const hiddenLabelCount = computed(() => nodes.value.filter((n) => !n.showLabel).length)

const kw = computed(() => q.value.trim().toLowerCase())
function matchesSearch(n: PlacedNode): boolean {
  if (!kw.value) return false
  return (n.friend.name + n.friend.alias).toLowerCase().includes(kw.value)
}
function isDimmed(n: PlacedNode): boolean {
  if (relFilter.value !== 'all' && n.rel !== relFilter.value) return true
  if (kw.value && !matchesSearch(n)) return true
  return false
}

// 详情抽屉（只读）
const drawerOpen = ref(false)
const drawerFriend = ref<Friend | null>(null)

function openNode(n: PlacedNode) {
  drawerFriend.value = n.friend
  drawerOpen.value = true
}
function closeDrawer() {
  drawerOpen.value = false
  drawerFriend.value = null
}
function editInTable() {
  closeDrawer()
  router.push('/friends')
}

function fmtDate(ts: number) { return ts ? new Date(ts).toLocaleDateString('zh-CN') : '—' }
function fmtMsg(n: number) { return n >= 10000 ? (n / 10000).toFixed(1) + '万' : n.toLocaleString('zh-CN') }
</script>

<template>
  <TheTopbar />

  <!-- empty state -->
  <main v-if="!data.hasData" class="wrap page">
    <div class="empty-page">
      <p>还没有数据，请先<router-link to="/import">去导入</router-link>聊天记录。</p>
    </div>
  </main>

  <main v-else class="wrap page">
    <div class="page-head">
      <div>
        <span class="eyebrow">关系网</span>
        <h1>你的关系网</h1>
        <p>以你为圆心，所有好友环绕四周。颜色代表关系，越靠近你、点越大代表往来越多。点任意一个查看详情。</p>
      </div>
    </div>

    <!-- toolbar：搜索 + 关系筛选（chip 兼作图例） -->
    <div class="toolbar">
      <div class="search">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        <input class="input" type="search" placeholder="搜索昵称、备注…" aria-label="搜索好友" v-model="q" />
      </div>
      <div class="filters" role="group" aria-label="按关系筛选">
        <button class="chip" :aria-pressed="relFilter === 'all'" @click="relFilter = 'all'">全部</button>
        <button
          v-for="rname in RELATIONS"
          :key="rname"
          class="chip"
          :aria-pressed="relFilter === rname"
          @click="relFilter = rname"
        >
          <span class="rel-dot" :style="{ background: relColor(rname) }"></span>{{ rname }}
        </button>
      </div>
      <span class="count"><b>{{ nodes.length }}</b> 位好友</span>
    </div>

    <!-- SVG 关系网 -->
    <div class="graph-wrap">
      <svg class="graph" :viewBox="`0 0 ${SIZE} ${SIZE}`" role="img" aria-label="关系网图">
        <!-- 背景同心环 -->
        <circle v-for="f in [0.4, 0.7, 1]" :key="f" :cx="CENTER" :cy="CENTER" :r="f * R"
          fill="none" stroke="var(--border)" stroke-width="1" :stroke-dasharray="f === 1 ? '2 4' : undefined" />

        <!-- 连线 -->
        <line v-for="n in nodes" :key="'l-' + n.id" :x1="CENTER" :y1="CENTER" :x2="n.x" :y2="n.y"
          class="link" :class="{ dimmed: isDimmed(n) }" stroke="var(--border-2)" stroke-width="1" />

        <!-- 节点 -->
        <g v-for="n in nodes" :key="n.id" @click="openNode(n)" style="cursor:pointer">
          <circle
            class="node"
            :class="{ dimmed: isDimmed(n), hit: matchesSearch(n) }"
            :cx="n.x" :cy="n.y" :r="n.r"
            :fill="relColor(n.rel)"
          />
          <text v-if="n.showLabel" class="node-label" :class="{ dimmed: isDimmed(n) }"
            :x="n.x" :y="n.y + n.r + 12" text-anchor="middle">{{ n.friend.name }}</text>
        </g>

        <!-- 圆心：我 -->
        <circle :cx="CENTER" :cy="CENTER" r="28" fill="var(--surface)" stroke="var(--accent)" stroke-width="1.5" />
        <circle :cx="CENTER" :cy="CENTER" r="17" fill="none" stroke="var(--accent)" stroke-width="1.4" opacity="0.6" />
        <circle :cx="CENTER" :cy="CENTER" r="7" fill="var(--accent)" />
        <text :x="CENTER" :y="CENTER + 46" text-anchor="middle" class="me-label">我</text>
      </svg>
      <p v-if="hiddenLabelCount > 0" class="graph-note">为避免拥挤，仅标注往来最多的 {{ LABEL_LIMIT }} 位，共显示全部 {{ nodes.length }} 位好友。</p>
    </div>
  </main>

  <!-- 只读详情抽屉 -->
  <div class="scrim" :class="{ open: drawerOpen }" @click="closeDrawer"></div>
  <aside class="drawer" :class="{ open: drawerOpen }" :aria-hidden="!drawerOpen" aria-label="好友详情">
    <div class="drawer-head">
      <div class="av avatar" :style="drawerFriend ? { background: relColor(drawerFriend.rel) } : {}">
        {{ drawerFriend ? initials(drawerFriend.name) : '—' }}
      </div>
      <div>
        <div class="nm">{{ drawerFriend?.name ?? '—' }}</div>
        <div class="al">{{ drawerFriend ? (drawerFriend.alias ? '备注：' + drawerFriend.alias + ' · ' : '') + drawerFriend.rel : '—' }}</div>
      </div>
      <button class="drawer-close" aria-label="关闭" @click="closeDrawer">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div v-if="drawerFriend" class="drawer-body">
      <div class="d-grid">
        <div class="d-field"><div class="lab">首次联系</div><div class="val">{{ fmtDate(drawerFriend.firstContact) }}</div></div>
        <div class="d-field"><div class="lab">最近联系</div><div class="val">{{ fmtDate(drawerFriend.lastContact) }}</div></div>
        <div class="d-field"><div class="lab">消息总数</div><div class="val num">{{ fmtMsg(drawerFriend.msgCount) }} 条</div></div>
        <div class="d-field"><div class="lab">收发比（我:对方）</div><div class="val num">{{ drawerFriend.sentRatio }} : {{ 100 - drawerFriend.sentRatio }}</div></div>
        <div class="d-field"><div class="lab">活跃时段</div><div class="val">{{ drawerFriend.peakPeriod || '—' }}</div></div>
        <div class="d-field"><div class="lab">最长连续聊天</div><div class="val num">{{ drawerFriend.maxStreak }} 天</div></div>
      </div>

      <div class="d-sec-title">全年消息分布</div>
      <div class="spark">
        <div v-for="(v, i) in drawerFriend.monthly" :key="i" class="col"
          :style="{ height: Math.max(4, Math.round(v / (Math.max(...drawerFriend.monthly) || 1) * 100)) + '%' }">
          <span>{{ i + 1 }}</span>
        </div>
      </div>

      <button class="btn btn-primary" type="button" style="margin-top:24px;" @click="editInTable">在好友表中编辑</button>
    </div>
  </aside>

  <TheFooter />
</template>

<style scoped>
.page { padding: 32px 0 0; }
.page-head { margin-bottom: 20px; }
.page-head h1 { font-size: 26px; }
.page-head .eyebrow { font-family: var(--font-mono); font-size: 11px; color: var(--accent-strong); letter-spacing: 0.12em; }
.page-head p { color: var(--muted); margin-top: 6px; font-size: 14px; max-width: 46em; }

.toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.search { position: relative; flex: 1; min-width: 200px; max-width: 340px; }
.search svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--faint); }
.search .input { padding-left: 36px; }
.filters { display: flex; gap: 7px; flex-wrap: wrap; }
.rel-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; margin-right: 5px; vertical-align: middle; }
.count { margin-left: auto; font-size: 13px; color: var(--muted); white-space: nowrap; }
.count b { color: var(--fg); font-family: var(--font-mono); }

.graph-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: var(--shadow-sm); padding: 16px; }
.graph { width: 100%; height: auto; display: block; max-width: 720px; margin: 0 auto; }
.graph-note { text-align: center; font-size: 12px; color: var(--faint); margin-top: 8px; }

.link { transition: opacity .18s; }
.link.dimmed { opacity: 0.12; }
.node { transition: opacity .18s, stroke-width .18s; stroke: var(--surface); stroke-width: 1.5; }
.node.dimmed { opacity: 0.18; }
.node.hit { stroke: var(--accent-strong); stroke-width: 3; }
.node-label { font-size: 12px; fill: var(--muted); transition: opacity .18s; pointer-events: none; }
.node-label.dimmed { opacity: 0.2; }
.me-label { font-size: 13px; font-weight: 600; fill: var(--fg); }

.empty-page { padding: 80px 20px; text-align: center; color: var(--muted); font-size: 16px; }
.empty-page a { color: var(--accent); text-decoration: underline; }

/* 抽屉（沿用好友页样式） */
.scrim { position: fixed; inset: 0; background: oklch(20% 0.02 200 / 0.32); opacity: 0; pointer-events: none; transition: opacity .2s; z-index: 50; }
.scrim.open { opacity: 1; pointer-events: auto; }
.drawer { position: fixed; top: 0; right: 0; height: 100%; width: 420px; max-width: 92vw; background: var(--surface); border-left: 1px solid var(--border); box-shadow: var(--shadow-lg); transform: translateX(100%); transition: transform .26s cubic-bezier(.4,0,.2,1); z-index: 51; display: flex; flex-direction: column; }
.drawer.open { transform: translateX(0); }
.drawer-head { padding: 22px 24px 18px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 14px; }
.drawer-head .av { width: 52px; height: 52px; border-radius: 15px; display: grid; place-items: center; color: #fff; font-weight: 600; }
.drawer-head .nm { font-size: 19px; font-weight: 600; }
.drawer-head .al { color: var(--faint); font-size: 13px; }
.drawer-close { margin-left: auto; width: 36px; height: 36px; border-radius: 9px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; display: grid; place-items: center; color: var(--muted); }
.drawer-close:hover { background: var(--surface-2); }
.drawer-body { padding: 22px 24px; overflow-y: auto; }
.d-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; }
.d-field .lab { font-size: 11.5px; color: var(--faint); }
.d-field .val { font-size: 14px; font-weight: 550; margin-top: 2px; }
.d-field .val.num { font-family: var(--font-mono); }
.d-sec-title { font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: 0.04em; text-transform: uppercase; margin: 24px 0 12px; }
.spark { display: flex; align-items: flex-end; gap: 4px; height: 72px; padding: 8px 0; }
.spark .col { flex: 1; background: var(--accent-wash); border: 1px solid var(--accent-line); border-bottom: 0; border-radius: 4px 4px 0 0; position: relative; min-height: 3px; }
.spark .col span { position: absolute; bottom: -18px; left: 0; right: 0; text-align: center; font-size: 9px; color: var(--faint); font-family: var(--font-mono); }

@media (max-width: 760px) {
  .count { width: 100%; margin-left: 0; }
}
</style>
```

- [ ] **Step 4: Register the route**

修改 `packages/web/src/router/index.ts`：

1. 顶部 import 区新增：
```ts
import RelationGraphPage from '../pages/RelationGraphPage.vue'
```
2. 在 `friends` 与 `report` 两条路由之间插入：
```ts
    { path: '/graph', name: 'graph', component: RelationGraphPage },
```

- [ ] **Step 5: Add the nav link**

修改 `packages/web/src/components/TheTopbar.vue`，在 `<nav class="nav">` 内「好友信息」与「年度报告」之间插入：

```html
        <router-link to="/graph">关系网</router-link>
```

- [ ] **Step 6: Run the page tests to verify they pass**

Run: `pnpm --filter @nianlun/web exec vitest run src/pages/__tests__/RelationGraphPage.test.ts`
Expected: PASS（5 个测试全过）。

- [ ] **Step 7: Run the full web suite + typecheck/build**

Run: `pnpm --filter @nianlun/web exec vitest run`
Expected: PASS（含既有 TheTopbar/Overview 等测试不回归）。

Run: `pnpm --filter @nianlun/web build`
Expected: `vue-tsc --noEmit` 通过、`vite build` 成功。

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/pages/RelationGraphPage.vue packages/web/src/pages/__tests__/RelationGraphPage.test.ts packages/web/src/router/index.ts packages/web/src/components/TheTopbar.vue
git commit -m "feat(web): add relationship-graph page with filter, search and detail drawer"
```

---

## 收尾验证（全部任务完成后）

- [ ] Run: `pnpm -r test` — 整个仓库测试全绿。
- [ ] Run: `pnpm -r build` — core + web 均构建成功。
- [ ] 手动核对（`pnpm --filter @nianlun/web dev`）：导入数据后访问 `/graph`，节点环绕、配色正确、筛选/搜索/点节点抽屉均正常；无数据时显示空状态。
