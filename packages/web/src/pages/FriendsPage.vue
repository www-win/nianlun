<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDataStore } from '../stores/data'
import type { Friend, Relation } from '@nianlun/core'
import { buildFriendAnalysisPrompt } from '@nianlun/core'
import AiPanel from '../components/AiPanel.vue'
import TheTopbar from '../components/TheTopbar.vue'
import TheFooter from '../components/TheFooter.vue'

const data = useDataStore()
const q = ref('')
const relFilter = ref<'all' | Relation>('all')
const sortKey = ref<'name' | 'rel' | 'role' | 'first' | 'last' | 'msgs'>('msgs')
const sortDir = ref(-1)
const RELATIONS: Relation[] = ['家人', '挚友', '同事', '同学', '客户', '其他']

const REL_COLORS: Record<string, string> = {
  '家人': 'oklch(60% 0.12 25)',
  '挚友': 'oklch(62% 0.12 145)',
  '同事': 'oklch(58% 0.1 250)',
  '同学': 'oklch(66% 0.13 75)',
  '客户': 'oklch(58% 0.11 320)',
  '其他': 'oklch(60% 0.02 240)',
}

const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase()
  let list = data.friends.filter((f) => {
    if (relFilter.value !== 'all' && f.rel !== relFilter.value) return false
    if (!kw) return true
    return (f.name + f.alias + f.role + f.rel).toLowerCase().includes(kw)
  })
  const k = sortKey.value, dir = sortDir.value
  return [...list].sort((a, b) => {
    if (k === 'name') return a.name.localeCompare(b.name, 'zh') * dir
    if (k === 'rel') return a.rel.localeCompare(b.rel, 'zh') * dir
    if (k === 'role') return (a.role || '￿').localeCompare(b.role || '￿', 'zh') * dir
    if (k === 'first') return (a.firstContact - b.firstContact) * dir
    if (k === 'last') return (a.lastContact - b.lastContact) * dir
    return (a.msgCount - b.msgCount) * dir
  })
})

const maxMsgs = computed(() => Math.max(...data.friends.map((f) => f.msgCount), 1))
const roleCount = computed(() => data.friends.filter((f) => f.role).length)

function fmtDate(ts: number) { return ts ? new Date(ts).toLocaleDateString('zh-CN') : '—' }
function fmtMsg(n: number) { return n >= 10000 ? (n / 10000).toFixed(1) + '万' : n.toLocaleString('zh-CN') }
function initials(name: string) { return name.slice(name.length > 1 ? name.length - 2 : 0) }
function relColor(rel: string) { return REL_COLORS[rel] || 'oklch(60% 0.02 240)' }

function setSort(k: typeof sortKey.value) {
  if (sortKey.value === k) {
    sortDir.value *= -1
  } else {
    sortKey.value = k
    sortDir.value = (k === 'name' || k === 'rel' || k === 'role') ? 1 : -1
  }
}

function saveRole(f: Friend, role: string) { data.updateFriend(f.id, { role }) }
function saveRel(f: Friend, rel: Relation) { data.updateFriend(f.id, { rel }) }

function exportCsv() {
  const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`
  const header = ['昵称', '备注', '关系', '职务', '首次联系', '最近联系', '消息数', '我发出%']
  const lines = [header.map(q).join(',')].concat(filtered.value.map((f) =>
    [f.name, f.alias, f.rel, f.role, fmtDate(f.firstContact), fmtDate(f.lastContact), f.msgCount, f.sentRatio].map(q).join(',')))
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = '好友信息.csv'; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// drawer state
const drawerOpen = ref(false)
const drawerFriend = ref<Friend | null>(null)
const drawerRole = ref('')
const drawerAlias = ref('')
const drawerRel = ref<Relation>('其他')
const openRelMenuId = ref<string | null>(null)

function openDrawer(f: Friend) {
  drawerFriend.value = f
  drawerRole.value = f.role
  drawerAlias.value = f.alias
  drawerRel.value = f.rel
  drawerOpen.value = true
}

function closeDrawer() {
  drawerOpen.value = false
  drawerFriend.value = null
}

function friendPrompt() {
  return drawerFriend.value ? buildFriendAnalysisPrompt(drawerFriend.value) : ''
}

function saveDrawer() {
  if (!drawerFriend.value) return
  data.updateFriend(drawerFriend.value.id, {
    role: drawerRole.value.trim(),
    alias: drawerAlias.value.trim(),
    rel: drawerRel.value,
  })
  closeDrawer()
}

function toggleRelMenu(id: string, e: Event) {
  e.stopPropagation()
  openRelMenuId.value = openRelMenuId.value === id ? null : id
}

function pickRel(f: Friend, rel: Relation, e: Event) {
  e.stopPropagation()
  saveRel(f, rel)
  openRelMenuId.value = null
}

function handleRowClick(f: Friend) {
  openRelMenuId.value = null
  openDrawer(f)
}

function handleRoleBlur(f: Friend, e: Event) {
  const el = e.target as HTMLElement
  saveRole(f, el.textContent?.trim() || '')
}

function handleRoleKey(f: Friend, e: KeyboardEvent) {
  const el = e.target as HTMLElement
  if (e.key === 'Enter') { e.preventDefault(); el.blur() }
  if (e.key === 'Escape') { el.textContent = f.role; el.blur() }
}
</script>

<template>
  <TheTopbar />

  <!-- empty state -->
  <main v-if="!data.hasData" class="wrap page">
    <div class="empty-page">
      <p>还没有数据，请先<router-link to="/import">去导入</router-link>聊天记录。</p>
    </div>
  </main>

  <!-- main content -->
  <main v-else class="wrap page" @click="openRelMenuId = null">
    <div class="page-head">
      <div>
        <span class="eyebrow">STEP 02 · 好友信息</span>
        <h1>好友信息整理表</h1>
        <p>自动归集联系时间与往来，手动补充职务和关系标签。点击任意一行查看详情。</p>
      </div>
      <button class="btn btn-sm" type="button" @click="exportCsv">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M8 10 5 7M8 10l3-3M3 11.5V13h10v-1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        导出当前视图
      </button>
    </div>

    <!-- summary strip -->
    <div class="summary">
      <div class="sm">
        <div class="k">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="6" r="2.4" stroke="currentColor" stroke-width="1.2"/><path d="M2 13c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6M11 9.6c1.4.3 2.5 1.4 2.5 3.1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          好友总数
        </div>
        <div class="v">{{ data.friends.length }}</div>
      </div>
      <div class="sm">
        <div class="k">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 3h12v10H2zM2 6h12" stroke="currentColor" stroke-width="1.2"/></svg>
          已补充职务
        </div>
        <div class="v">{{ roleCount }}<small>/{{ data.friends.length }}</small></div>
      </div>
      <div class="sm">
        <div class="k">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/><path d="M8 5v3.2l2 1.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          首次联系
        </div>
        <div class="v">{{ data.friends.length ? fmtDate(Math.min(...data.friends.map(f => f.firstContact).filter(Boolean))) : '—' }}</div>
      </div>
      <div class="sm">
        <div class="k">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 13 6 7l3 3 5-7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          年度消息
        </div>
        <div class="v">{{ data.report ? fmtMsg(data.report.totalMessages) : '—' }}<small v-if="data.report">条</small></div>
      </div>
    </div>

    <!-- toolbar -->
    <div class="toolbar">
      <div class="search">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        <input class="input" type="search" placeholder="搜索昵称、备注、职务…" aria-label="搜索好友" v-model="q" />
      </div>
      <div class="filters" role="group" aria-label="按关系筛选">
        <button class="chip" :aria-pressed="relFilter === 'all'" @click="relFilter = 'all'">全部</button>
        <button
          v-for="r in RELATIONS"
          :key="r"
          class="chip"
          :aria-pressed="relFilter === r"
          @click="relFilter = r"
        >{{ r }}</button>
      </div>
      <span class="count"><b>{{ filtered.length }}</b> 位好友</span>
    </div>

    <!-- table -->
    <div class="tbl-wrap">
      <div class="tbl-scroll">
        <table class="table">
          <thead>
            <tr>
              <th @click="setSort('name')" style="cursor:pointer">
                好友 <span class="arr">{{ sortKey === 'name' ? (sortDir === 1 ? '▴' : '▾') : '' }}</span>
              </th>
              <th @click="setSort('rel')" style="cursor:pointer">
                关系 <span class="arr">{{ sortKey === 'rel' ? (sortDir === 1 ? '▴' : '▾') : '' }}</span>
              </th>
              <th @click="setSort('role')" style="cursor:pointer">
                职务 / 标签 <span class="arr">{{ sortKey === 'role' ? (sortDir === 1 ? '▴' : '▾') : '' }}</span>
              </th>
              <th @click="setSort('first')" style="cursor:pointer">
                首次联系 <span class="arr">{{ sortKey === 'first' ? (sortDir === 1 ? '▴' : '▾') : '' }}</span>
              </th>
              <th @click="setSort('last')" style="cursor:pointer">
                最近联系 <span class="arr">{{ sortKey === 'last' ? (sortDir === 1 ? '▴' : '▾') : '' }}</span>
              </th>
              <th @click="setSort('msgs')" style="cursor:pointer" :aria-sort="sortKey === 'msgs' ? (sortDir === 1 ? 'ascending' : 'descending') : undefined">
                消息往来 <span class="arr">{{ sortKey === 'msgs' ? (sortDir === 1 ? '▴' : '▾') : '' }}</span>
              </th>
              <th style="width:34px;"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="f in filtered"
              :key="f.id"
              @click="handleRowClick(f)"
              style="cursor:pointer"
            >
              <!-- friend cell -->
              <td>
                <div class="friend-cell">
                  <div class="avatar" :style="{ background: relColor(f.rel) }">{{ initials(f.name) }}</div>
                  <div class="meta">
                    <div class="nm">{{ f.name }}</div>
                    <div class="al">{{ f.alias || '未备注' }}</div>
                  </div>
                </div>
              </td>

              <!-- relation cell -->
              <td>
                <div class="rel-pick" @click.stop>
                  <span
                    class="tag"
                    :style="{ color: relColor(f.rel), borderColor: relColor(f.rel) }"
                    style="cursor:pointer"
                    @click="toggleRelMenu(f.id, $event)"
                  >
                    <span class="rel-dot" :style="{ background: relColor(f.rel) }"></span>
                    {{ f.rel }}
                  </span>
                  <div v-if="openRelMenuId === f.id" class="rel-menu open">
                    <button
                      v-for="r in RELATIONS"
                      :key="r"
                      @click="pickRel(f, r, $event)"
                    >
                      <span class="rel-dot" :style="{ background: relColor(r) }"></span>{{ r }}
                    </button>
                  </div>
                </div>
              </td>

              <!-- role cell -->
              <td class="role-cell" @click.stop>
                <span
                  class="role-edit"
                  :class="{ empty: !f.role }"
                  contenteditable="true"
                  @blur="handleRoleBlur(f, $event)"
                  @keydown="handleRoleKey(f, $event)"
                  @click.stop
                >{{ f.role || '补充职务…' }}</span>
              </td>

              <!-- first contact -->
              <td class="time-cell num-cell">{{ fmtDate(f.firstContact) }}</td>

              <!-- last contact -->
              <td class="time-cell">{{ fmtDate(f.lastContact) }}</td>

              <!-- messages -->
              <td>
                <div class="num-cell">
                  {{ fmtMsg(f.msgCount) }} 条
                  <span class="faint" style="font-size:11px;">· 我 {{ f.sentRatio }}%</span>
                </div>
                <div class="bar">
                  <i :style="{ width: Math.round(f.msgCount / maxMsgs * 100) + '%' }"></i>
                </div>
              </td>

              <!-- open indicator -->
              <td class="row-open">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </td>
            </tr>

            <!-- no results within filtered list -->
            <tr v-if="filtered.length === 0">
              <td colspan="7">
                <div class="empty-state">没有匹配的好友，试试换个关键词或筛选。</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <!-- detail drawer -->
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
        <div
          v-for="(v, i) in drawerFriend.monthly"
          :key="i"
          class="col"
          :style="{ height: Math.max(4, Math.round(v / (Math.max(...drawerFriend.monthly) || 1) * 100)) + '%' }"
        >
          <span>{{ i + 1 }}</span>
        </div>
      </div>

      <div class="d-sec-title">AI 分析</div>
      <AiPanel
        :key="drawerFriend.id"
        :build-prompt="friendPrompt"
        button-label="✨ AI 分析"
        busy-label="分析中…"
      />

      <div class="d-sec-title">编辑信息</div>
      <div class="d-edit">
        <div class="field">
          <label>职务 / 标签</label>
          <input class="input" v-model="drawerRole" placeholder="例如：产品经理、大学室友" />
        </div>
        <div class="field">
          <label>备注</label>
          <input class="input" v-model="drawerAlias" />
        </div>
        <div class="field">
          <label>关系</label>
          <select class="input" v-model="drawerRel">
            <option v-for="r in RELATIONS" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>
        <button class="btn btn-primary" type="button" style="margin-top:4px;" @click="saveDrawer">保存修改</button>
      </div>
    </div>
  </aside>

  <TheFooter />
</template>

<style scoped>
.page { padding: 32px 0 0; }
.page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 20px; }
.page-head h1 { font-size: 26px; }
.page-head p { color: var(--muted); margin-top: 6px; font-size: 14px; }

/* summary strip */
.summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
.sm { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); padding: 13px 16px; }
.sm .k { font-size: 11.5px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
.sm .k svg { color: var(--accent-strong); }
.sm .v { font-family: var(--font-mono); font-size: 22px; font-weight: 600; letter-spacing: -0.02em; margin-top: 3px; }
.sm .v small { font-family: var(--font-body); font-size: 12px; color: var(--faint); margin-left: 3px; }

/* toolbar */
.toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.search { position: relative; flex: 1; min-width: 200px; max-width: 340px; }
.search svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--faint); }
.search .input { padding-left: 36px; }
.filters { display: flex; gap: 7px; flex-wrap: wrap; }
.count { margin-left: auto; font-size: 13px; color: var(--muted); white-space: nowrap; }
.count b { color: var(--fg); font-family: var(--font-mono); }

/* table */
.tbl-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); overflow: hidden; box-shadow: var(--shadow-sm); }
.tbl-scroll { overflow-x: auto; }
.friend-cell { display: flex; align-items: center; gap: 11px; min-width: 180px; }
.friend-cell .meta .nm { font-weight: 600; font-size: 14px; }
.friend-cell .meta .al { font-size: 12px; color: var(--faint); }
td.role-cell { min-width: 150px; }
.role-edit {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 7px;
  border: 1px dashed transparent; cursor: text; font-size: 13px; color: var(--fg); min-width: 60px;
  transition: border-color .14s, background .14s;
}
.role-edit:hover { border-color: var(--border-2); background: var(--surface-2); }
.role-edit.empty { color: var(--faint); font-style: italic; }
.role-edit:focus { outline: none; border-color: var(--accent); border-style: solid; background: var(--surface); }
.role-edit .pen { opacity: 0; color: var(--faint); }
.role-edit:hover .pen { opacity: 1; }

.rel-pick { position: relative; }
.rel-pick > .tag { cursor: pointer; }
.rel-menu { position: absolute; top: calc(100% + 4px); left: 0; z-index: 20; background: var(--surface); border: 1px solid var(--border-2); border-radius: 10px; box-shadow: var(--shadow-lg); padding: 5px; min-width: 110px; display: none; }
.rel-menu.open { display: block; }
.rel-menu button { display: flex; width: 100%; align-items: center; gap: 8px; padding: 7px 9px; border: 0; background: transparent; border-radius: 7px; cursor: pointer; font-family: inherit; font-size: 13px; color: var(--fg); }
.rel-menu button:hover { background: var(--surface-2); }
.rel-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }

.num-cell { font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.bar { height: 5px; border-radius: 999px; background: var(--surface-2); margin-top: 5px; overflow: hidden; min-width: 64px; }
.bar > i { display: block; height: 100%; background: var(--accent); border-radius: 999px; }
.time-cell { white-space: nowrap; font-size: 13px; }
.time-cell .rel { color: var(--faint); font-size: 11.5px; }
.row-open { color: var(--faint); }
tr { cursor: pointer; }

.empty-state { padding: 50px 20px; text-align: center; color: var(--faint); }
.empty-page { padding: 80px 20px; text-align: center; color: var(--muted); font-size: 16px; }
.empty-page a { color: var(--accent); text-decoration: underline; }

/* drawer */
.scrim { position: fixed; inset: 0; background: oklch(20% 0.02 200 / 0.32); opacity: 0; pointer-events: none; transition: opacity .2s; z-index: 50; }
.scrim.open { opacity: 1; pointer-events: auto; }
.drawer { position: fixed; top: 0; right: 0; height: 100%; width: 420px; max-width: 92vw; background: var(--surface); border-left: 1px solid var(--border); box-shadow: var(--shadow-lg); transform: translateX(100%); transition: transform .26s cubic-bezier(.4,0,.2,1); z-index: 51; display: flex; flex-direction: column; }
.drawer.open { transform: translateX(0); }
.drawer-head { padding: 22px 24px 18px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 14px; }
.drawer-head .av { width: 52px; height: 52px; border-radius: 15px; }
.drawer-head .nm { font-size: 19px; font-weight: 600; font-family: var(--font-display); }
.drawer-head .al { color: var(--faint); font-size: 13px; }
.drawer-close { margin-left: auto; width: 36px; height: 36px; border-radius: 9px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; display: grid; place-items: center; color: var(--muted); }
.drawer-close:hover { background: var(--surface-2); }
.drawer-body { padding: 22px 24px; overflow-y: auto; }
.d-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; }
.d-field .lab { font-size: 11.5px; color: var(--faint); letter-spacing: 0.02em; }
.d-field .val { font-size: 14px; font-weight: 550; margin-top: 2px; }
.d-field .val.num { font-family: var(--font-mono); }
.d-sec-title { font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: 0.04em; text-transform: uppercase; margin: 24px 0 12px; }
.spark { display: flex; align-items: flex-end; gap: 4px; height: 72px; padding: 8px 0; }
.spark .col { flex: 1; background: var(--accent-wash); border: 1px solid var(--accent-line); border-bottom: 0; border-radius: 4px 4px 0 0; position: relative; min-height: 3px; }
.spark .col span { position: absolute; bottom: -18px; left: 0; right: 0; text-align: center; font-size: 9px; color: var(--faint); font-family: var(--font-mono); }
.d-edit { display: grid; gap: 10px; margin-top: 6px; }
.d-edit .field label { font-size: 11.5px; }

@media (max-width: 760px) {
  .summary { grid-template-columns: repeat(2, 1fr); }
  .count { width: 100%; margin-left: 0; }
}
</style>
