# 好友关系亲疏图（关系图页）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立页面 `/network`「关系图」，把全体好友以「同心环 + 关系扇区」画成一张以「我」为中心的星形亲疏图（半径=亲密度排名、颜色=关系类型），支持 hover tooltip、click 跳好友表、图例过滤。

**Architecture:** 一个纯函数 `computeLayout`（`web/src/lib/networkLayout.ts`）把 `Friend[]` 算成带坐标的 `NodeLayout[]`；一个 Vue 页面 `NetworkPage.vue` 用纯 SVG 渲染并处理轻交互；注册路由 `/network` 并在顶栏加入口。布局是视觉决策，放 web 层而非 core。

**Tech Stack:** Vue 3 `<script setup>`、TypeScript、纯 SVG（零新依赖）、Vitest + jsdom + @vue/test-utils、Pinia、vue-router。

## Global Constraints

- 包管理用 **pnpm**（monorepo workspace），不用 npm/yarn。
- 本功能**全部在 `@nianlun/web`**：不改 `@nianlun/core`、不碰 worker/parseClient、不改 store 数据形状。
- 页面**只从 store 读取**数据，不修改 store、不直接调用 core。本功能是只读视图，不涉及 `updateFriend`。
- **纯 SVG，零新增依赖**；不引入 d3/echarts。
- **复用** `web/src/lib/relations.ts` 现有的 `RELATIONS`（关系顺序数组）与 `relColor()`（oklch 配色），**不重新定义配色或顺序**。
- 测试用 **Vitest**；web 测试在 **jsdom** 下用 **@vue/test-utils**。
- web 单测运行命令：`pnpm --filter @nianlun/web exec vitest run <文件路径>`。
- 每次 commit 的 message 结尾追加：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 当前工作分支：`feat/friend-network-page`（已存在，spec 在此分支）。

---

### Task 1: 布局纯函数 `computeLayout`

**Files:**
- Create: `packages/web/src/lib/networkLayout.ts`
- Test: `packages/web/src/lib/__tests__/networkLayout.test.ts`

**Interfaces:**
- Consumes: `RELATIONS`、`relColor` from `../relations`；`Friend`、`Relation` from `@nianlun/core`。
- Produces:
  - `interface NodeLayout { id: string; name: string; rel: Relation; x: number; y: number; r: number; color: string; msgCount: number }`
  - `interface LayoutInput { friends: Friend[]; size: number; activeRels: Set<Relation> }`
  - `function computeLayout(input: LayoutInput): NodeLayout[]` —— 只返回 `rel ∈ activeRels` 的节点；`activeRels` 为空集时返回 `[]`。确定性（无随机、无时间）。

- [ ] **Step 1: 写失败测试**

创建 `packages/web/src/lib/__tests__/networkLayout.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { computeLayout } from '../networkLayout'
import { RELATIONS } from '../relations'
import type { Friend, Relation } from '@nianlun/core'

function makeFriend(id: string, rel: Relation, msgCount: number): Friend {
  return {
    id, name: id, alias: '', rel, role: '',
    firstContact: 0, lastContact: 0, msgCount, sentRatio: 50,
    peakPeriod: '', maxStreak: 0, monthly: Array(12).fill(0), userEdited: {},
  }
}
const SIZE = 720
const CENTER = SIZE / 2
const ALL = () => new Set<Relation>(RELATIONS)
const dist = (n: { x: number; y: number }) => Math.hypot(n.x - CENTER, n.y - CENTER)

describe('computeLayout', () => {
  it('空好友返回空数组', () => {
    expect(computeLayout({ friends: [], size: SIZE, activeRels: ALL() })).toEqual([])
  })

  it('只返回 activeRels 内的关系节点', () => {
    const friends = [
      makeFriend('a', '家人', 10),
      makeFriend('b', '同事', 10),
      makeFriend('c', '同学', 10),
    ]
    const out = computeLayout({ friends, size: SIZE, activeRels: new Set<Relation>(['家人']) })
    expect(out.map((n) => n.id)).toEqual(['a'])
  })

  it('全部隐藏(空 activeRels)返回空', () => {
    const friends = [makeFriend('a', '家人', 10)]
    expect(computeLayout({ friends, size: SIZE, activeRels: new Set() })).toEqual([])
  })

  it('消息越多离圆心越近(亲密度=半径单调)', () => {
    const friends = [
      makeFriend('low', '家人', 10),
      makeFriend('mid', '家人', 100),
      makeFriend('high', '家人', 1000),
    ]
    const out = computeLayout({ friends, size: SIZE, activeRels: ALL() })
    const by = Object.fromEntries(out.map((n) => [n.id, n]))
    expect(dist(by.high)).toBeLessThan(dist(by.mid))
    expect(dist(by.mid)).toBeLessThan(dist(by.low))
  })

  it('消息越多节点越大', () => {
    const friends = [makeFriend('low', '家人', 10), makeFriend('high', '家人', 1000)]
    const out = computeLayout({ friends, size: SIZE, activeRels: ALL() })
    const by = Object.fromEntries(out.map((n) => [n.id, n]))
    expect(by.high.r).toBeGreaterThan(by.low.r)
  })

  it('节点角度落在所属关系的扇区内', () => {
    // 家人是 RELATIONS[0] → 扇区 [0, 60°)，即落在第一象限 (x>=center, y>=center)
    const out = computeLayout({ friends: [makeFriend('a', '家人', 10)], size: SIZE, activeRels: ALL() })
    const n = out[0]
    const sector = (2 * Math.PI) / RELATIONS.length
    let ang = Math.atan2(n.y - CENTER, n.x - CENTER)
    if (ang < 0) ang += 2 * Math.PI
    expect(ang).toBeGreaterThanOrEqual(0)
    expect(ang).toBeLessThan(sector)
  })

  it('相同输入产出完全相同(确定性)', () => {
    const friends = [makeFriend('a', '家人', 10), makeFriend('b', '同事', 50)]
    const a = computeLayout({ friends, size: SIZE, activeRels: ALL() })
    const b = computeLayout({ friends, size: SIZE, activeRels: ALL() })
    expect(a).toEqual(b)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run src/lib/__tests__/networkLayout.test.ts`
Expected: FAIL —— 报 `computeLayout` 无法从 `../networkLayout` 导入（模块不存在）。

- [ ] **Step 3: 写最小实现**

创建 `packages/web/src/lib/networkLayout.ts`：

```ts
// 以「我」为中心的星形关系亲疏图布局。纯函数、确定性(无随机/无时间)。
// 角度=关系类型扇区,半径=亲密度(msgCount)排名分位:越亲密越靠圆心。
import type { Friend, Relation } from '@nianlun/core'
import { RELATIONS, relColor } from './relations'

export interface NodeLayout {
  id: string
  name: string
  rel: Relation
  x: number
  y: number
  r: number
  color: string
  msgCount: number
}

export interface LayoutInput {
  friends: Friend[]
  size: number
  activeRels: Set<Relation>
}

// 确定性字符串哈希(FNV-1a),归一化到 [0,1),用于同扇区内角度错位避免重叠。
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 0x100000000
}

export function computeLayout(input: LayoutInput): NodeLayout[] {
  const { friends, size, activeRels } = input
  const visible = friends.filter((f) => activeRels.has(f.rel))
  if (visible.length === 0) return []

  const center = size / 2
  const innerR = size * 0.13 // 中心留给「我」核心
  const outerR = size * 0.46 // 外圈留边距
  const sector = (2 * Math.PI) / RELATIONS.length

  // 亲密度排名:按 msgCount 升序,同值按 id 稳定排序(保证确定性)。
  const ranked = [...visible].sort(
    (a, b) => a.msgCount - b.msgCount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const n = ranked.length
  const rankOf = new Map(ranked.map((f, i) => [f.id, i]))

  return visible.map((f) => {
    const i = rankOf.get(f.id)! // 0=最疏, n-1=最亲
    const t = n > 1 ? i / (n - 1) : 0.5
    const radius = outerR - t * (outerR - innerR) // 越亲密(t大)越靠内
    const si = Math.max(0, RELATIONS.indexOf(f.rel))
    const angle = si * sector + hash01(f.id) * sector // 扇区基角 + 扇区内错位
    return {
      id: f.id,
      name: f.name,
      rel: f.rel,
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
      r: 4 + t * 8, // 亲密的节点更大(4~12px)
      color: relColor(f.rel),
      msgCount: f.msgCount,
    }
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run src/lib/__tests__/networkLayout.test.ts`
Expected: PASS —— 7 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/lib/networkLayout.ts packages/web/src/lib/__tests__/networkLayout.test.ts
git commit -m "feat(web): add network layout pure function (friend → polar node)"
```
（commit message 末尾按 Global Constraints 追加 Co-Authored-By 行。）

---

### Task 2: 关系图页面 `NetworkPage.vue`

**Files:**
- Create: `packages/web/src/pages/NetworkPage.vue`
- Test: `packages/web/src/pages/__tests__/NetworkPage.test.ts`

**Interfaces:**
- Consumes: `computeLayout`、`NodeLayout` from `../lib/networkLayout`；`RELATIONS`、`relColor` from `../lib/relations`；`useDataStore` from `../stores/data`；`useRouter` from `vue-router`；`TheTopbar`/`TheFooter` 组件。
- Produces: 默认导出的 Vue 组件。无数据时渲染含 `to="/import"` 的引导卡片；有数据时渲染 `<circle class="node">` per 可见好友、6 个图例 `<button class="chip">`、中心「我」。点击节点 `router.push({ name: 'friends', query: { focus: id } })`。

- [ ] **Step 1: 写失败测试**

创建 `packages/web/src/pages/__tests__/NetworkPage.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import NetworkPage from '../NetworkPage.vue'
import { useDataStore } from '../../stores/data'
import type { Friend, Relation } from '@nianlun/core'

function makeFriend(id: string, rel: Relation, msgCount: number): Friend {
  return {
    id, name: id, alias: '', rel, role: '',
    firstContact: 0, lastContact: 0, msgCount, sentRatio: 50,
    peakPeriod: '', maxStreak: 0, monthly: Array(12).fill(0), userEdited: {},
  }
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/import', '/friends', '/report', '/network'].map((p) => ({
      path: p, name: p === '/' ? 'overview' : p.slice(1), component: { template: '<div/>' },
    })),
  })
}

async function mountWith(friends: Friend[]) {
  const router = makeRouter(); router.push('/network'); await router.isReady()
  const store = useDataStore()
  store.friends = friends
  const wrapper = mount(NetworkPage, { global: { plugins: [router] } })
  return { wrapper, router }
}

describe('NetworkPage', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('无数据时显示去导入引导', async () => {
    const { wrapper } = await mountWith([])
    expect(wrapper.text()).toContain('还没有数据')
    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(hrefs).toContain('/import')
    expect(wrapper.findAll('circle.node').length).toBe(0)
  })

  it('有数据时每个好友渲染一个节点', async () => {
    const { wrapper } = await mountWith([
      makeFriend('a', '家人', 10),
      makeFriend('b', '同事', 20),
      makeFriend('c', '同学', 30),
    ])
    expect(wrapper.findAll('circle.node').length).toBe(3)
  })

  it('点击图例隐藏对应关系的节点', async () => {
    const { wrapper } = await mountWith([
      makeFriend('a', '家人', 10),
      makeFriend('b', '家人', 20),
      makeFriend('c', '同事', 30),
    ])
    expect(wrapper.findAll('circle.node').length).toBe(3)
    // 找到「同事」图例按钮并点击
    const chip = wrapper.findAll('button.chip').find((b) => b.text().includes('同事'))!
    await chip.trigger('click')
    expect(wrapper.findAll('circle.node').length).toBe(2)
  })

  it('点击节点跳转到好友表并带 focus 查询参数', async () => {
    const { wrapper, router } = await mountWith([makeFriend('a', '家人', 10)])
    await wrapper.find('circle.node').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('friends')
    expect(router.currentRoute.value.query.focus).toBe('a')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run src/pages/__tests__/NetworkPage.test.ts`
Expected: FAIL —— 无法从 `../NetworkPage.vue` 导入（组件不存在）。

- [ ] **Step 3: 写实现**

创建 `packages/web/src/pages/NetworkPage.vue`：

```vue
<script setup lang="ts">
// 关系图:以「我」为中心的星形好友亲疏图。纯展示,只从 data store 读。
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDataStore } from '../stores/data'
import { RELATIONS, relColor } from '../lib/relations'
import { computeLayout, type NodeLayout } from '../lib/networkLayout'
import type { Relation } from '@nianlun/core'
import TheTopbar from '../components/TheTopbar.vue'
import TheFooter from '../components/TheFooter.vue'

const data = useDataStore()
const router = useRouter()
const SIZE = 720

const activeRels = ref<Set<Relation>>(new Set(RELATIONS))
const hovered = ref<NodeLayout | null>(null)

const counts = computed(() => {
  const m = Object.fromEntries(RELATIONS.map((r) => [r, 0])) as Record<Relation, number>
  for (const f of data.friends) m[f.rel] = (m[f.rel] ?? 0) + 1
  return m
})

const nodes = computed(() =>
  computeLayout({ friends: data.friends, size: SIZE, activeRels: activeRels.value }),
)

// 6 条扇区分隔线终点
const spokes = computed(() =>
  RELATIONS.map((_, i) => {
    const a = (i / RELATIONS.length) * 2 * Math.PI
    return { x: SIZE / 2 + SIZE * 0.46 * Math.cos(a), y: SIZE / 2 + SIZE * 0.46 * Math.sin(a) }
  }),
)

function toggleRel(rel: Relation) {
  if (counts.value[rel] === 0) return
  const next = new Set(activeRels.value)
  if (next.has(rel)) next.delete(rel)
  else next.add(rel)
  activeRels.value = next
}

function gotoFriend(n: NodeLayout) {
  router.push({ name: 'friends', query: { focus: n.id } })
}
</script>

<template>
  <TheTopbar />
  <main class="wrap net-wrap">
    <div v-if="!data.hasData" class="empty card card-pad">
      <h2>还没有数据</h2>
      <p class="muted">先导入聊天记录,才能生成关系图。</p>
      <router-link class="btn btn-primary" to="/import">去导入</router-link>
    </div>

    <template v-else>
      <header class="net-head">
        <h1>关系图</h1>
        <p class="muted">越靠近圆心,今年和 TA 聊得越多;颜色代表关系类型。</p>
      </header>

      <div class="legend">
        <button
          v-for="rel in RELATIONS" :key="rel" class="chip"
          :class="{ off: !activeRels.has(rel), dim: counts[rel] === 0 }"
          :disabled="counts[rel] === 0" @click="toggleRel(rel)"
        >
          <i :style="{ background: relColor(rel) }"></i>{{ rel }}<small>{{ counts[rel] }}</small>
        </button>
      </div>

      <div class="stage">
        <svg :viewBox="`0 0 ${SIZE} ${SIZE}`" class="net-svg">
          <circle :cx="SIZE / 2" :cy="SIZE / 2" :r="SIZE * 0.46" class="ring" />
          <circle :cx="SIZE / 2" :cy="SIZE / 2" :r="SIZE * 0.3" class="ring" />
          <circle :cx="SIZE / 2" :cy="SIZE / 2" :r="SIZE * 0.13" class="ring dashed" />
          <line
            v-for="(p, i) in spokes" :key="i"
            :x1="SIZE / 2" :y1="SIZE / 2" :x2="p.x" :y2="p.y" class="spoke"
          />
          <circle
            v-for="n in nodes" :key="n.id" class="node"
            :cx="n.x" :cy="n.y" :r="hovered?.id === n.id ? n.r * 1.6 : n.r" :fill="n.color"
            @mouseenter="hovered = n" @mouseleave="hovered = null" @click="gotoFriend(n)"
          />
          <circle :cx="SIZE / 2" :cy="SIZE / 2" :r="SIZE * 0.07" class="core-bg" />
          <text
            :x="SIZE / 2" :y="SIZE / 2" class="core-text"
            dominant-baseline="central" text-anchor="middle"
          >我</text>
        </svg>
        <div
          v-if="hovered" class="tip"
          :style="{ left: (hovered.x / SIZE) * 100 + '%', top: (hovered.y / SIZE) * 100 + '%' }"
        >
          <b>{{ hovered.name }}</b><span>{{ hovered.rel }} · {{ hovered.msgCount }} 条</span>
        </div>
      </div>
    </template>
  </main>
  <TheFooter />
</template>

<style scoped>
.net-wrap { padding: 32px 0 56px; }
.empty { display: grid; place-items: center; gap: 12px; text-align: center; padding: 56px 24px; }
.net-head { text-align: center; margin-bottom: 18px; }
.net-head h1 { font-size: 24px; }
.net-head .muted { font-size: 13.5px; margin-top: 6px; }

.legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-bottom: 18px; }
.chip {
  display: inline-flex; align-items: center; gap: 7px; padding: 5px 12px;
  border: 1px solid var(--border-2); border-radius: 999px; background: var(--surface);
  font-size: 13px; font-weight: 550; cursor: pointer; transition: opacity .14s, background .14s;
}
.chip i { width: 12px; height: 12px; border-radius: 4px; }
.chip small { color: var(--faint); font-family: var(--font-mono); }
.chip.off { opacity: 0.4; }
.chip.dim { opacity: 0.3; cursor: default; }

.stage { position: relative; width: 100%; max-width: 560px; aspect-ratio: 1; margin: 0 auto; }
.net-svg { width: 100%; height: 100%; overflow: visible; }
.ring { fill: none; stroke: var(--border-2); stroke-width: 1; }
.ring.dashed { stroke-dasharray: 4 5; }
.spoke { stroke: var(--border); stroke-width: 1; opacity: 0.5; }
.node { cursor: pointer; transition: r .12s; stroke: var(--surface); stroke-width: 1.5; }
.core-bg { fill: var(--surface); stroke: var(--border); stroke-width: 1.5; }
.core-text { font-family: var(--font-serif); font-size: 28px; fill: var(--accent-strong); }

.tip {
  position: absolute; transform: translate(-50%, -130%); pointer-events: none;
  background: var(--surface); border: 1px solid var(--border-2); border-radius: 8px;
  box-shadow: var(--shadow-sm); padding: 6px 10px; white-space: nowrap;
  display: flex; flex-direction: column; gap: 2px; font-size: 12.5px;
}
.tip span { color: var(--muted); }
</style>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run src/pages/__tests__/NetworkPage.test.ts`
Expected: PASS —— 4 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/pages/NetworkPage.vue packages/web/src/pages/__tests__/NetworkPage.test.ts
git commit -m "feat(web): add friend network page (radial proximity graph)"
```
（末尾追加 Co-Authored-By 行。）

---

### Task 3: 注册路由 + 顶栏入口

**Files:**
- Modify: `packages/web/src/router/index.ts`
- Modify: `packages/web/src/components/TheTopbar.vue:16-21`
- Modify: `packages/web/src/components/__tests__/TheTopbar.test.ts:9,19`

**Interfaces:**
- Consumes: `NetworkPage.vue`（Task 2）。
- Produces: 路由 `{ path: '/network', name: 'network', component: NetworkPage }`；顶栏导航多一个指向 `/network` 的链接「关系图」，位于「好友信息」与「年度报告」之间。

- [ ] **Step 1: 更新 TheTopbar 测试(先让它反映目标)**

修改 `packages/web/src/components/__tests__/TheTopbar.test.ts`，把第 9 行的 routes 列表与第 19 行的断言改为包含 `/network`：

第 9 行改为：
```ts
    routes: ['/', '/import', '/friends', '/network', '/report'].map((p) => ({ path: p, component: { template: '<div/>' } })),
```

第 19 行改为：
```ts
    expect(hrefs).toEqual(['/', '/import', '/friends', '/network', '/report'])
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run src/components/__tests__/TheTopbar.test.ts`
Expected: FAIL —— 实际 hrefs 仍是 4 个（`['/', '/import', '/friends', '/report']`），与期望的 5 个不符。

- [ ] **Step 3: 在顶栏加入口**

修改 `packages/web/src/components/TheTopbar.vue`，在 `<nav>` 里「好友信息」与「年度报告」之间插入一行（即第 19、20 行之间）：

```html
        <router-link to="/friends">好友信息</router-link>
        <router-link to="/network">关系图</router-link>
        <router-link to="/report">年度报告</router-link>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run src/components/__tests__/TheTopbar.test.ts`
Expected: PASS。

- [ ] **Step 5: 注册路由**

修改 `packages/web/src/router/index.ts`：在文件顶部其它页面 import 之后加入 `NetworkPage` 的 import，并在 `routes` 数组中 `friends` 与 `report` 之间插入路由。

import 区加：
```ts
import NetworkPage from '../pages/NetworkPage.vue'
```

`routes` 数组里 `{ path: '/friends', ... }` 之后、`{ path: '/report', ... }` 之前插入：
```ts
    { path: '/network', name: 'network', component: NetworkPage },
```

- [ ] **Step 6: 跑全量 web 测试确认无回归**

Run: `pnpm --filter @nianlun/web exec vitest run`
Expected: PASS —— 全部测试通过（含新增的 networkLayout、NetworkPage，以及更新后的 TheTopbar）。

- [ ] **Step 7: 类型检查 + 构建**

Run: `pnpm --filter @nianlun/web build`
Expected: `vue-tsc --noEmit` 无类型错误，`vite build` 成功。

- [ ] **Step 8: 提交**

```bash
git add packages/web/src/router/index.ts packages/web/src/components/TheTopbar.vue packages/web/src/components/__tests__/TheTopbar.test.ts
git commit -m "feat(web): register /network route and add topbar entry"
```
（末尾追加 Co-Authored-By 行。）

---

## 验收清单（全部完成后）

- [ ] `/network` 路由可访问，顶栏有「关系图」入口。
- [ ] 无数据时显示「还没有数据 → 去导入」引导。
- [ ] 有数据时每个好友是一个彩色节点，越亲密越靠圆心、节点越大，中心是「我」。
- [ ] hover 节点放大并浮出 tooltip（名字/关系/消息数）。
- [ ] 点击节点跳到好友表（带 `?focus=id`）。
- [ ] 点击图例 chip 切换对应关系显隐；0 人的 chip 置灰不可点。
- [ ] `pnpm --filter @nianlun/web exec vitest run` 全绿，`pnpm --filter @nianlun/web build` 通过。
