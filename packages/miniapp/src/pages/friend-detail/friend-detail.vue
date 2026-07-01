<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { Relation } from '@nianlun/core'
import { useDataStore } from '../../stores/data'
import { samples } from '../../adapters/samples'
import { aiClient } from '../../adapters/aiClient'
import { wordCloudItems, weekHourHeatmap, monthlyTrend } from '../../lib/insights'

const data = useDataStore()
const id = ref('')
onLoad((q) => { id.value = decodeURIComponent((q?.id as string) || '') })

const friend = computed(() => data.friends.find((f) => f.id === id.value) || null)

const REL_COLORS: Record<string, string> = {
  家人: '#d96a5a', 挚友: '#43a86a', 同事: '#5a7fd0', 同学: '#cf9a36', 客户: '#b066b0', 其他: '#8a8f99',
}
const relColor = (r: string) => REL_COLORS[r] || '#8a8f99'
const initials = (n: string) => n.slice(n.length > 1 ? n.length - 2 : 0)
const fmtDate = (ts: number) => (ts ? new Date(ts).toISOString().slice(0, 10) : '—')

const FONT = { 1: 24, 2: 28, 3: 33, 4: 39, 5: 46 } as Record<number, number>
const OPACITY = { 1: 0.45, 2: 0.6, 3: 0.72, 4: 0.86, 5: 1 } as Record<number, number>
const HOUR_TICKS = [0, 6, 12, 18, 23]

const trend = computed(() => monthlyTrend(friend.value ? [friend.value] : []))
const heat = computed(() => weekHourHeatmap(friend.value?.weekHour ?? []))
const words = computed(() => wordCloudItems(friend.value?.keywords ?? []))
const chatSamples = computed(() => samples.loadSamplesFor(id.value))
const showSamples = ref(false)

function cellAlpha(count: number): number {
  if (heat.value.max === 0) return 0
  return count === 0 ? 0 : 0.12 + (count / heat.value.max) * 0.88
}

const RELS: Relation[] = ['家人', '挚友', '同事', '同学', '客户', '其他']
function onRel(e: { detail: { value: number } }) {
  if (friend.value) data.updateFriend(friend.value.id, { rel: RELS[e.detail.value] })
}
function onRole(e: { detail: { value: string } }) {
  if (friend.value) data.updateFriend(friend.value.id, { role: e.detail.value })
}

async function suggest() {
  const f = friend.value
  if (!f) return
  const s = samples.loadSamplesFor(f.id)
  const ok = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '使用 AI 智能建议',
      content: `将发送约 ${s.length} 条聊天片段到 AI 服务用于推断关系，是否继续？`,
      success: (r) => resolve(r.confirm),
    })
  })
  if (!ok) return
  try {
    const sug = await aiClient.suggestFriend(f, s)
    if (sug.rel || sug.role) {
      await data.updateFriend(f.id, { rel: sug.rel, role: sug.role })
      uni.showToast({ title: '已应用建议' })
    } else {
      uni.showToast({ title: 'AI 无法判断', icon: 'none' })
    }
  } catch (e) { uni.showToast({ title: (e as Error).message, icon: 'none' }) }
}
</script>

<template>
  <view class="page">
    <view v-if="!friend" class="empty">
      <view class="e-icon">🙁</view>
      <view class="e-text">找不到这位好友，可能数据已更新</view>
    </view>

    <template v-else>
      <view class="card head">
        <view class="avatar" :style="{ background: relColor(friend.rel) }">{{ initials(friend.alias || friend.name) }}</view>
        <text class="name">{{ friend.alias || friend.name }}</text>
        <view class="tags">
          <view class="tag" :style="{ background: relColor(friend.rel) }">{{ friend.rel }}</view>
          <text v-if="friend.role" class="role-tag">{{ friend.role }}</text>
        </view>
      </view>

      <view class="card block">
        <view class="kv-grid">
          <view class="kv"><text class="kv-v num">{{ friend.msgCount }}</text><text class="kv-l">消息总数</text></view>
          <view class="kv"><text class="kv-v num">{{ friend.sentRatio }}%</text><text class="kv-l">我方占比</text></view>
          <view class="kv"><text class="kv-v num">{{ friend.maxStreak }}</text><text class="kv-l">最长连聊(天)</text></view>
        </view>
        <view class="kv-lines">
          <view class="kv-line"><text class="kl">活跃时段</text><text class="kr">{{ friend.peakPeriod || '—' }}</text></view>
          <view class="kv-line"><text class="kl">首次联系</text><text class="kr">{{ fmtDate(friend.firstContact) }}</text></view>
          <view class="kv-line"><text class="kl">最近联系</text><text class="kr">{{ fmtDate(friend.lastContact) }}</text></view>
        </view>
      </view>

      <view v-if="trend.total > 0" class="card block">
        <text class="block-t">月度趋势</text>
        <view class="bars">
          <view v-for="m in trend.months" :key="m.label" class="bar-col">
            <view class="bar-track"><view class="bar-fill" :style="{ height: m.pct + '%' }"></view></view>
            <text class="bar-lbl">{{ m.label.replace('月', '') }}</text>
          </view>
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
                :style="{ backgroundColor: 'rgba(16,163,122,' + cellAlpha(c) + ')' }"
              ></view>
            </view>
          </view>
        </view>
        <text v-if="heat.peak" class="hm-peak muted">最活跃：周{{ heat.peak.label }} {{ heat.peak.hour }} 点</text>
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

      <view class="card block">
        <view class="edit-row">
          <picker :range="RELS" @change="onRel"><text class="act">改关系</text></picker>
          <text class="act act-ai" @click="suggest">✦ 智能建议</text>
        </view>
        <input class="role-input" :value="friend.role" placeholder="职务 / 备注" placeholder-class="ph" @blur="onRole" />
      </view>

      <view v-if="chatSamples.length" class="card block">
        <view class="block-head" @click="showSamples = !showSamples">
          <text class="block-t">聊天样本（{{ chatSamples.length }}）</text>
          <text class="chev">{{ showSamples ? '▴' : '▾' }}</text>
        </view>
        <view v-if="showSamples" class="samples">
          <text v-for="(s, i) in chatSamples" :key="i" class="sample">{{ s }}</text>
        </view>
        <text v-else class="samples-hint faint">本地样本，仅存于本机、不上传 · 点开查看</text>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page { padding: 32rpx 28rpx 64rpx; }

.head { display: flex; flex-direction: column; align-items: center; padding: 44rpx 32rpx; }
.avatar {
  width: 120rpx; height: 120rpx; border-radius: 32rpx;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 40rpx; font-weight: 600;
}
.name { margin-top: 20rpx; font-size: 36rpx; font-weight: 700; color: var(--fg); }
.tags { display: flex; align-items: center; gap: 14rpx; margin-top: 14rpx; }
.tag { padding: 4rpx 18rpx; border-radius: 999rpx; font-size: 22rpx; font-weight: 600; color: #fff; }
.role-tag { padding: 4rpx 16rpx; border-radius: 8rpx; font-size: 22rpx; background: var(--accent-wash); color: var(--accent-strong); }

.block { margin-top: 24rpx; padding: 32rpx 36rpx; }
.block-t { font-size: 28rpx; font-weight: 600; color: var(--fg); }
.block-head { display: flex; align-items: center; justify-content: space-between; }
.chev { color: var(--faint); }

.kv-grid { display: flex; }
.kv { flex: 1; display: flex; flex-direction: column; align-items: center; }
.kv-v { font-size: 44rpx; font-weight: 700; color: var(--accent-strong); }
.kv-l { margin-top: 6rpx; font-size: 22rpx; color: var(--muted); }
.kv-lines { margin-top: 28rpx; }
.kv-line { display: flex; justify-content: space-between; padding: 14rpx 0; border-top: 1rpx solid var(--border); }
.kl { font-size: 25rpx; color: var(--muted); }
.kr { font-size: 25rpx; color: var(--fg); }

.bars { display: flex; align-items: flex-end; gap: 8rpx; height: 200rpx; margin-top: 28rpx; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; }
.bar-track { flex: 1; width: 100%; display: flex; align-items: flex-end; }
.bar-fill { width: 100%; min-height: 4rpx; background: var(--accent); border-radius: 6rpx 6rpx 0 0; }
.bar-lbl { margin-top: 10rpx; font-size: 20rpx; color: var(--faint); }

.hm { margin-top: 24rpx; }
.hm-axis, .hm-row { display: flex; align-items: center; }
.hm-row { margin-top: 6rpx; }
.hm-corner, .hm-day { flex: none; width: 40rpx; font-size: 22rpx; color: var(--faint); text-align: center; }
.hm-ticks, .hm-cells { flex: 1; display: flex; gap: 4rpx; }
.hm-tick { flex: 1; font-size: 18rpx; color: var(--faint); text-align: center; }
.hm-cell { flex: 1; height: 26rpx; border-radius: 4rpx; background: var(--surface-2); }
.hm-peak { display: block; margin-top: 20rpx; font-size: 23rpx; }

.cloud { display: flex; flex-wrap: wrap; align-items: baseline; gap: 16rpx 24rpx; margin-top: 24rpx; }
.word { color: var(--accent-strong); font-weight: 600; line-height: 1.2; }

.edit-row { display: flex; align-items: center; gap: 16rpx; }
.act { padding: 12rpx 22rpx; border-radius: 12rpx; font-size: 24rpx; font-weight: 550; color: var(--muted); background: var(--surface-2); }
.act-ai { color: var(--accent-strong); background: var(--accent-wash); }
.role-input { margin-top: 18rpx; height: 64rpx; padding: 0 20rpx; font-size: 25rpx; color: var(--fg); background: var(--surface); border: 1rpx solid var(--border-2); border-radius: 12rpx; }
.ph { color: var(--faint); }

.samples { margin-top: 20rpx; }
.sample { display: block; padding: 14rpx 0; border-top: 1rpx solid var(--border); font-size: 25rpx; color: var(--muted); line-height: 1.6; }
.samples-hint { display: block; margin-top: 16rpx; font-size: 22rpx; }

.empty { margin-top: 160rpx; text-align: center; color: var(--faint); }
.e-icon { font-size: 96rpx; opacity: 0.5; }
.e-text { margin-top: 24rpx; font-size: 28rpx; }
</style>
