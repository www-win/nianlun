<script setup lang="ts">
import { computed } from 'vue'
import { sumWeekHour } from '@nianlun/core'
import { useDataStore } from '../../stores/data'
import { useBackupStore } from '../../stores/backup'
import { wordCloudItems, weekHourHeatmap, monthlyTrend } from '../../lib/insights'
import AntennaBuddy from '../../components/AntennaBuddy.vue'

const data = useDataStore()
const backup = useBackupStore()

async function onBackup() {
  await backup.backupNow()
  uni.showToast({ title: backup.status === 'error' ? '备份失败' : '已备份', icon: backup.status === 'error' ? 'none' : 'success' })
}
function onRestore() {
  uni.showModal({
    title: '从云端恢复', content: '将从云端备份写回本机数据（本地已有的会被云端版本覆盖），确定吗？',
    success: async (r) => {
      if (!r.confirm) return
      const ok = await backup.restoreNow()
      if (ok) { await data.hydrate(); uni.showToast({ title: '已恢复', icon: 'success' }) }
      else uni.showToast({ title: '云端暂无备份', icon: 'none' })
    },
  })
}
function goChatQa() {
  uni.navigateTo({ url: '/pages/chat-qa/chat-qa' })
}

const REL_COLORS: Record<string, string> = {
  家人: '#d96a5a', 挚友: '#43a86a', 同事: '#5a7fd0', 同学: '#cf9a36', 客户: '#b066b0', 其他: '#8a8f99',
}
const relColor = (r: string) => REL_COLORS[r] || '#8a8f99'

// 高频词标签云：字号/深浅按 tier（1–5）
const FONT = { 1: 24, 2: 28, 3: 33, 4: 39, 5: 46 } as Record<number, number>
const OPACITY = { 1: 0.45, 2: 0.6, 3: 0.72, 4: 0.86, 5: 1 } as Record<number, number>
const words = computed(() => wordCloudItems(data.report?.keywords ?? []))

// 月度互动趋势（12 根柱）
const trend = computed(() => monthlyTrend(data.friends))

// 活跃时段热力图（周一→周日 × 24 小时）
const heat = computed(() => weekHourHeatmap(sumWeekHour(data.friends)))
const HOUR_TICKS = [0, 6, 12, 18, 23]
function cellAlpha(count: number): number {
  if (heat.value.max === 0) return 0
  return count === 0 ? 0 : 0.12 + (count / heat.value.max) * 0.88
}

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
        <view class="head-l">
          <text class="eyebrow">年度概览</text>
          <text class="year num">{{ data.report.year }}</text>
        </view>
        <AntennaBuddy :color="'var(--dipsy)'" antenna="rod" :scale="0.66" />
      </view>

      <view class="card qa-entry" @click="goChatQa">
        <text class="qa-emoji">💬</text>
        <view class="qa-mid">
          <text class="qa-t">问问我的聊天记录</text>
          <text class="qa-s">具体的事、规律、关系都能问</text>
        </view>
        <text class="qa-arrow">›</text>
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

      <view v-if="trend.total > 0" class="card block">
        <text class="block-t">月度趋势</text>
        <view class="bars">
          <view v-for="m in trend.months" :key="m.label" class="bar-col">
            <view class="bar-track">
              <view class="bar-fill" :style="{ height: m.pct + '%' }"></view>
            </view>
            <text class="bar-lbl">{{ m.label.replace('月', '') }}</text>
          </view>
        </view>
        <text v-if="trend.peak" class="hm-peak muted">最活跃：{{ trend.peak.label }}（{{ trend.peak.count }} 条）</text>
      </view>

      <view v-if="words.length" class="card block">
        <text class="block-t">高频词</text>
        <view class="cloud">
          <text
            v-for="w in words" :key="w.word"
            class="word"
            :style="{ fontSize: FONT[w.tier] + 'rpx', opacity: OPACITY[w.tier] }"
          >{{ w.word }}</text>
        </view>
      </view>

      <view v-if="heat.max > 0" class="card block">
        <text class="block-t">活跃时段</text>
        <view class="hm">
          <view class="hm-axis">
            <text class="hm-corner"></text>
            <view class="hm-ticks">
              <text v-for="h in 24" :key="h" class="hm-tick">{{ HOUR_TICKS.includes(h - 1) ? (h - 1) : '' }}</text>
            </view>
          </view>
          <view v-for="row in heat.rows" :key="row.label" class="hm-row">
            <text class="hm-day">{{ row.label }}</text>
            <view class="hm-cells">
              <view
                v-for="(c, i) in row.cells" :key="i"
                class="hm-cell"
                :style="{ backgroundColor: 'rgba(67,196,99,' + cellAlpha(c) + ')' }"
              ></view>
            </view>
          </view>
        </view>
        <text v-if="heat.peak" class="hm-peak muted">最活跃：周{{ heat.peak.label }} {{ heat.peak.hour }} 点（{{ heat.peak.count }} 条）</text>
      </view>
    </template>

    <!-- 数据与备份：始终显示（空状态也要能「从云端恢复」，否则数据丢了反而看不到恢复按钮） -->
    <view class="card" style="margin-top:24rpx;padding:28rpx">
      <view class="eyebrow">数据与备份</view>
      <view class="muted" style="margin:12rpx 0">
        {{ backup.lastBackupAt ? '上次备份：' + new Date(backup.lastBackupAt).toLocaleString() : '尚未备份' }}
      </view>
      <view style="display:flex;gap:16rpx">
        <button class="btn-primary" style="flex:1" :loading="backup.status==='backing'" @click="onBackup">立即备份到云</button>
        <button class="btn-ghost" style="flex:1" :loading="backup.status==='restoring'" @click="onRestore">从云端恢复</button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { padding: 40rpx 36rpx 64rpx; }

.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28rpx; }
.head-l { display: flex; flex-direction: column; }
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

/* 月度趋势柱状图 */
.bars { display: flex; align-items: flex-end; gap: 10rpx; height: 220rpx; margin-top: 28rpx; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; }
.bar-track { flex: 1; width: 100%; display: flex; align-items: flex-end; }
.bar-fill { width: 100%; min-height: 4rpx; background: var(--accent); border-radius: 6rpx 6rpx 0 0; }
.bar-lbl { margin-top: 10rpx; font-size: 20rpx; color: var(--faint); }

/* 高频词标签云 */
.cloud { display: flex; flex-wrap: wrap; align-items: baseline; gap: 16rpx 24rpx; margin-top: 24rpx; }
.word { color: var(--accent-strong); font-weight: 600; line-height: 1.2; }

/* 活跃时段热力图 */
.hm { margin-top: 24rpx; }
.hm-axis, .hm-row { display: flex; align-items: center; }
.hm-row { margin-top: 6rpx; }
.hm-corner, .hm-day { flex: none; width: 40rpx; font-size: 22rpx; color: var(--faint); text-align: center; }
.hm-ticks, .hm-cells { flex: 1; display: flex; gap: 4rpx; }
.hm-tick { flex: 1; font-size: 18rpx; color: var(--faint); text-align: center; }
.hm-cell { flex: 1; height: 26rpx; border-radius: 4rpx; background: var(--surface-2); }
.hm-peak { display: block; margin-top: 20rpx; font-size: 23rpx; }

.qa-entry { display: flex; align-items: center; gap: 20rpx; padding: 26rpx 28rpx; margin-bottom: 20rpx; }
.qa-emoji { font-size: 44rpx; }
.qa-mid { flex: 1; display: flex; flex-direction: column; }
.qa-t { font-size: 28rpx; font-weight: 700; color: var(--fg); }
.qa-s { margin-top: 6rpx; font-size: 23rpx; color: var(--muted); }
.qa-arrow { font-size: 40rpx; color: var(--muted); }
</style>
