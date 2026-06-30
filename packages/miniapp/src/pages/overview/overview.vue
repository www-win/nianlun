<script setup lang="ts">
import { computed } from 'vue'
import { useDataStore } from '../../stores/data'

const data = useDataStore()

const REL_COLORS: Record<string, string> = {
  家人: '#d96a5a', 挚友: '#43a86a', 同事: '#5a7fd0', 同学: '#cf9a36', 客户: '#b066b0', 其他: '#8a8f99',
}
const relColor = (r: string) => REL_COLORS[r] || '#8a8f99'

const stats = computed(() => {
  const r = data.report
  if (!r) return []
  return [
    { label: '好友', value: r.friendCount, unit: '位' },
    { label: '全年消息', value: r.totalMessages, unit: '条' },
    { label: '活跃', value: r.activeDays, unit: '天' },
  ]
})

const nameById = computed(() => {
  const m: Record<string, string> = {}
  for (const f of data.friends) m[f.id] = f.alias || f.name
  return m
})

const top = computed(() => {
  const r = data.report
  if (!r) return []
  const max = r.topContacts[0]?.msgCount || 1
  return r.topContacts.map((c, i) => ({
    rank: i + 1,
    name: nameById.value[c.friendId] || c.friendId,
    msgCount: c.msgCount,
    pct: Math.round((c.msgCount / max) * 100),
  }))
})

const rels = computed(() => (data.report?.relationBreakdown || []).filter((r) => r.percent > 0))
</script>

<template>
  <view class="page">
    <view v-if="!data.report" class="empty">
      <view class="e-icon">🪵</view>
      <view class="e-text">还没有数据，先到「导入」页导入聊天记录</view>
    </view>

    <template v-else>
      <view class="head">
        <text class="eyebrow">年度概览</text>
        <text class="year num">{{ data.report.year }}</text>
      </view>

      <view class="stats">
        <view v-for="s in stats" :key="s.label" class="card stat">
          <text class="s-num num">{{ s.value }}</text>
          <text class="s-label">{{ s.label }}<text class="s-unit">{{ s.unit }}</text></text>
        </view>
      </view>

      <view v-if="top.length" class="card block">
        <text class="block-t">聊得最多</text>
        <view v-for="t in top" :key="t.rank" class="trow">
          <text class="t-rank">{{ t.rank }}</text>
          <view class="t-mid">
            <view class="t-line">
              <text class="t-name">{{ t.name }}</text>
              <text class="t-count num muted">{{ t.msgCount }} 条</text>
            </view>
            <view class="t-bar"><view class="t-bar-in" :style="{ width: t.pct + '%' }"></view></view>
          </view>
        </view>
      </view>

      <view v-if="rels.length" class="card block">
        <text class="block-t">关系分布</text>
        <view class="dist">
          <view
            v-for="r in rels" :key="r.rel"
            class="dist-seg"
            :style="{ width: r.percent + '%', background: relColor(r.rel) }"
          ></view>
        </view>
        <view class="legend">
          <view v-for="r in rels" :key="r.rel" class="leg">
            <view class="dot" :style="{ background: relColor(r.rel) }"></view>
            <text class="leg-t">{{ r.rel }} {{ r.percent }}%</text>
          </view>
        </view>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page { padding: 40rpx 36rpx 64rpx; }

.head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 28rpx; }
.year { font-size: 40rpx; font-weight: 700; color: var(--fg); }

.stats { display: flex; gap: 20rpx; }
.stat { flex: 1; padding: 32rpx 20rpx; display: flex; flex-direction: column; align-items: center; }
.s-num { font-size: 56rpx; font-weight: 700; color: var(--accent-strong); line-height: 1.1; }
.s-label { margin-top: 10rpx; font-size: 24rpx; color: var(--muted); }
.s-unit { margin-left: 4rpx; font-size: 20rpx; color: var(--faint); }

.block { margin-top: 28rpx; padding: 32rpx 36rpx; }
.block-t { font-size: 28rpx; font-weight: 600; color: var(--fg); }

.trow { display: flex; align-items: center; margin-top: 26rpx; }
.t-rank {
  flex: none; width: 40rpx; height: 40rpx; margin-right: 20rpx;
  border-radius: 50%; background: var(--accent-wash); color: var(--accent-strong);
  font-size: 24rpx; font-weight: 700; text-align: center; line-height: 40rpx;
}
.t-mid { flex: 1; }
.t-line { display: flex; align-items: baseline; justify-content: space-between; }
.t-name { font-size: 28rpx; font-weight: 550; color: var(--fg); max-width: 360rpx; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.t-count { font-size: 24rpx; }
.t-bar { height: 10rpx; margin-top: 10rpx; border-radius: 999rpx; background: var(--surface-2); overflow: hidden; }
.t-bar-in { height: 100%; background: var(--accent); border-radius: 999rpx; }

.dist { display: flex; height: 28rpx; margin-top: 24rpx; border-radius: 999rpx; overflow: hidden; background: var(--surface-2); }
.dist-seg { height: 100%; }
.legend { display: flex; flex-wrap: wrap; gap: 12rpx 28rpx; margin-top: 22rpx; }
.leg { display: flex; align-items: center; }
.dot { width: 18rpx; height: 18rpx; border-radius: 50%; margin-right: 10rpx; }
.leg-t { font-size: 24rpx; color: var(--muted); }
</style>
