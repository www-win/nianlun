<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { onShow, onReachBottom } from '@dcloudio/uni-app'
import { useDataStore } from '../../stores/data'
import { useImportStore } from '../../stores/import'
import { useBackupStore } from '../../stores/backup'
import type { Relation } from '@nianlun/core'
import { effectiveMbtiCode } from '@nianlun/core'
import { storage } from '../../adapters/storage'
import { filterSortFriends } from '../../lib/friendsList'
import AntennaBuddy from '../../components/AntennaBuddy.vue'
import ProgressBar from '../../components/ProgressBar.vue'
import { useRelationDeepBadge } from '../../composables/useRelationDeepBadge'
import { useRelationDeepStore } from '../../stores/relationDeep'

useRelationDeepBadge()   // 深度分析进行中 → 好友 tab 红点（本页可见时同步）
const rd = useRelationDeepStore()   // 正在深度分析的好友 → 该行头像加红点，便于找回

const data = useDataStore()
const backup = useBackupStore()
const mbtiMap = ref<Record<string, string>>({})
function refreshMbti() {
  const m: Record<string, string> = {}
  const aiMap = storage.loadFriendMbtiMap()   // 整表一次读，避免每人一次同步 getStorageSync
  for (const f of data.friends) {
    const { code } = effectiveMbtiCode(f, aiMap[f.id]?.code ?? null)
    if (code) m[f.id] = code
  }
  mbtiMap.value = m
}
// 浅监听数组引用：导入/hydrate 重赋值 friends.value 时刷新。改关系/职务是原地编辑、
// 不影响 MBTI，无需 deep 深度追踪（deep 会对整个好友数组常驻响应式追踪，是卡顿来源）。
// 返回本页由 onShow 兜底刷新（friend-detail 里改的 MBTI 回来即生效）。
watch(() => data.friends, refreshMbti, { immediate: true })
onShow(refreshMbti)
const imp = useImportStore()
const kw = ref('')
const sortKey = ref<'msgCount' | 'lastContact'>('msgCount')
const RELS: Relation[] = ['家人', '挚友', '同事', '同学', '客户', '其他']

const REL_COLORS: Record<string, string> = {
  家人: '#d96a5a', 挚友: '#43a86a', 同事: '#5a7fd0', 同学: '#cf9a36', 客户: '#b066b0', 其他: '#8a8f99',
}
const relColor = (r: string) => REL_COLORS[r] || '#8a8f99'
const initials = (n: string) => n.slice(n.length > 1 ? n.length - 2 : 0)

function openDetail(id: string) {
  uni.navigateTo({ url: `/pages/friend-detail/friend-detail?id=${encodeURIComponent(id)}` })
}

// 分页渲染：几百上千好友一次性 v-for 会塞满 WXML 节点，滑动掉帧。
// 数据始终全在内存（data.friends），这里只限制“渲染多少张卡”，搜索/排序仍作用于全量。
const PAGE = 60
const visible = ref(PAGE)
// 全量过滤+排序（搜索能命中未渲染的好友，因为过滤走的是全部）
const filtered = computed(() => filterSortFriends(data.friends, kw.value, sortKey.value))
// 实际渲染的只有前 visible 条
const rows = computed(() => filtered.value.slice(0, visible.value))
// 触底再加载一批（页面级原生滚动，最顺，不改成 scroll-view）
onReachBottom(() => {
  if (visible.value < filtered.value.length) visible.value += PAGE
})
// 换关键字/排序时回到首屏，避免停留在“已展开几百条”
watch([kw, sortKey], () => { visible.value = PAGE })

function onRel(id: string, e: { detail: { value: number } }) {
  data.updateFriend(id, { rel: RELS[e.detail.value] })
}
function onRole(id: string, e: { detail: { value: string } }) {
  data.updateFriend(id, { role: e.detail.value })
}

// 手动分析单个好友：调 store，按返回枚举 toast（uni 仅在页面层用，store 保持纯）。
async function onAnalyze(id: string) {
  const f = data.friends.find((x) => x.id === id)
  const r = await imp.analyzeOne(id)
  if (r.status === 'ok') {
    uni.showToast({ title: `已分析：${f?.alias || f?.name || ''}`, icon: 'none' })
  } else if (r.status === 'empty') {
    uni.showToast({ title: '未分析出结果', icon: 'none' })
  } else if (r.status === 'error') {
    uni.showToast({ title: `分析失败：${r.error ?? ''}`, icon: 'none' })
  }
  // skipped（重入/无此人）：不提示
}
</script>

<template>
  <view class="page">
    <view v-if="!data.friends.length && backup.status === 'restoring'" class="page-loading">
      <ProgressBar indeterminate label="正在从云端恢复数据…" />
    </view>
    <view v-else-if="!data.friends.length" class="empty">
      <view class="e-icon">👥</view>
      <view class="e-text">还没有好友数据，先到「导入」页导入</view>
    </view>

    <template v-else>
      <view class="toolbar">
        <view class="search">
          <text class="s-ico">🔍</text>
          <input v-model="kw" placeholder="搜索好友" placeholder-class="ph" class="s-input" />
        </view>
        <view class="sort">
          <text class="chip" :class="{ on: sortKey === 'msgCount' }" @click="sortKey = 'msgCount'">按消息数</text>
          <text class="chip" :class="{ on: sortKey === 'lastContact' }" @click="sortKey = 'lastContact'">按最近联系</text>
        </view>
      </view>

      <view class="count-row">
        <text class="count faint">共 {{ filtered.length }} 位好友<text v-if="rows.length < filtered.length">（已显示 {{ rows.length }}）</text></text>
        <AntennaBuddy :color="'var(--laa)'" antenna="curl" :scale="0.5" />
      </view>

      <ProgressBar
        v-if="imp.analyzing"
        :percent="imp.analyzing.total
          ? Math.round(imp.analyzing.done / imp.analyzing.total * 100) : 0"
        :label="`分析关系/职务 ${imp.analyzing.done}/${imp.analyzing.total}`" />
      <ProgressBar
        v-else-if="imp.analyzingIds.size"
        indeterminate
        label="AI 分析中…" />

      <view v-for="f in rows" :key="f.id" class="card frow">
        <view class="top" @click="openDetail(f.id)">
          <view class="avatar" :style="{ background: relColor(f.rel) }">
            {{ initials(f.alias || f.name) }}
            <view v-if="rd.activeId === f.id" class="deep-dot" />
          </view>
          <view class="info">
            <text class="name">{{ f.alias || f.name }}</text>
            <view class="meta">
              <text class="num">{{ f.msgCount }}</text><text class="mu"> 条</text>
              <view class="tag" :style="{ background: relColor(f.rel) }">{{ f.rel }}</view>
              <view v-if="mbtiMap[f.id]" class="mbti-badge">{{ mbtiMap[f.id] }}</view>
              <text v-if="f.role" class="role-tag">{{ f.role }}</text>
            </view>
          </view>
          <text class="chevron">›</text>
        </view>
        <view class="acts">
          <picker class="act" :range="RELS" @change="(e) => onRel(f.id, e)">
            <text class="act-t">改关系</text>
          </picker>
          <view
            class="act act-ai" :class="{ busy: imp.analyzingIds.has(f.id) }"
            @click="onAnalyze(f.id)"
          >
            <text class="act-t">{{ imp.analyzingIds.has(f.id) ? '分析中…' : '🪄 AI分析' }}</text>
          </view>
          <input
            class="role-input" :value="f.role" placeholder="职务 / 备注"
            placeholder-class="ph" @blur="(e) => onRole(f.id, e)"
          />
        </view>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page { padding: 32rpx 28rpx 64rpx; }
.page-loading { margin-top: 200rpx; }

.toolbar { position: sticky; top: 0; z-index: 5; padding-bottom: 8rpx; background: var(--bg); }
.search {
  display: flex; align-items: center; height: 80rpx; padding: 0 24rpx;
  background: var(--surface); border: 1rpx solid var(--border-2); border-radius: 18rpx;
}
.s-ico { font-size: 26rpx; opacity: 0.5; margin-right: 14rpx; }
.s-input { flex: 1; font-size: 28rpx; color: var(--fg); }
.ph { color: var(--faint); }

.sort { display: flex; gap: 16rpx; margin-top: 20rpx; }
.chip {
  padding: 10rpx 24rpx; border-radius: 999rpx; font-size: 25rpx; font-weight: 550;
  color: var(--muted); background: var(--surface-2); border: 1rpx solid var(--border);
}
.chip.on { color: var(--accent-strong); background: var(--accent-wash); border-color: var(--accent-line); }

.count { display: block; margin: 24rpx 4rpx 16rpx; font-size: 23rpx; }

.frow { padding: 28rpx; margin-bottom: 20rpx; }
.top { display: flex; align-items: center; }
.avatar {
  position: relative;
  flex: none; width: 84rpx; height: 84rpx; border-radius: 24rpx; margin-right: 22rpx;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 28rpx; font-weight: 600;
}
/* 正在深度分析的好友：头像右上角红点（跟随 rd.activeId，跑完自动消失） */
.deep-dot {
  position: absolute; top: -6rpx; right: -6rpx;
  width: 24rpx; height: 24rpx; border-radius: 50%;
  background: var(--danger); border: 3rpx solid var(--surface);
}
.info { flex: 1; min-width: 0; }
.chevron { flex: none; margin-left: 12rpx; color: var(--faint); font-size: 40rpx; line-height: 1; }
.name { font-size: 30rpx; font-weight: 600; color: var(--fg); }
.meta { display: flex; align-items: center; flex-wrap: wrap; gap: 14rpx; margin-top: 8rpx; }
.meta .num { font-size: 25rpx; color: var(--muted); font-weight: 600; }
.meta .mu { font-size: 23rpx; color: var(--faint); }
.role-tag {
  padding: 3rpx 14rpx; border-radius: 8rpx; font-size: 21rpx;
  background: var(--accent-wash); color: var(--accent-strong);
}

.acts { display: flex; align-items: center; gap: 14rpx; margin-top: 22rpx; padding-top: 22rpx; border-top: 1rpx solid var(--border); }
.act {
  padding: 12rpx 22rpx; border-radius: 12rpx; font-size: 24rpx; font-weight: 550;
  color: var(--muted); background: var(--surface-2);
}
.act-t { font-size: 24rpx; }
.act-ai { color: var(--accent-strong); background: var(--accent-wash); }
.act-ai.busy { opacity: 0.5; }
.role-input {
  flex: 1; min-width: 160rpx; height: 60rpx; padding: 0 18rpx;
  font-size: 24rpx; color: var(--fg);
  background: var(--surface); border: 1rpx solid var(--border-2); border-radius: 12rpx;
}

.count-row { display: flex; align-items: center; justify-content: space-between; }

.mbti-badge {
  display: inline-block; margin-left: 12rpx; padding: 2rpx 12rpx;
  font-size: 20rpx; letter-spacing: 2rpx; color: #5a7fd0;
  background: rgba(90, 127, 208, 0.12); border-radius: 8rpx;
}
</style>
