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
