<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { storage } from '../../adapters/storage'
import { aggregateByStock, aggregateByRecommender, withRecommenderNames } from '@nianlun/core'
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
  // 用好友最新名覆盖 pick 里的推荐人名快照(导入通讯录/改名后同步)，与二级市场列表页一致。
  const nameById = new Map(storage.loadFriends().map((f) => [f.id, f.alias || f.name]))
  const picks = withRecommenderNames(storage.loadStockPicks(), nameById)
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
</script>

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
        <template v-if="card.logics.length">
          <view v-for="(l, i) in card.logics" :key="i" class="bullet">· {{ l }}</view>
        </template>
        <text v-else class="faint">暂无</text>
      </view>
      <!-- 第三层·公司信息 -->
      <view class="layer">
        <view class="l-h"><text class="no">3</text><text class="l-t">公司信息 · 谁说了啥</text></view>
        <template v-if="card.companyNotes.length">
          <view v-for="(n, i) in card.companyNotes" :key="i" class="bullet">· {{ n }}</view>
        </template>
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

<style scoped>
.page { padding: 32rpx 28rpx 64rpx; }

.title { font-size: 40rpx; font-weight: 700; color: var(--fg); margin-bottom: 20rpx; }
.sub { display: block; margin: -8rpx 0 20rpx; font-size: 25rpx; }

.layer {
  background: var(--surface); border: 1rpx solid var(--border); border-left: 6rpx solid var(--accent);
  border-radius: 16rpx; padding: 22rpx; margin-bottom: 18rpx;
}
.l-h { display: flex; align-items: center; margin-bottom: 14rpx; }
.no {
  flex: none; width: 40rpx; height: 40rpx; margin-right: 16rpx;
  border-radius: 50%; background: var(--accent-wash); color: var(--accent-strong);
  font-size: 22rpx; font-weight: 700; text-align: center; line-height: 40rpx;
}
.l-t { font-size: 28rpx; font-weight: 600; color: var(--fg); }

.kv { display: flex; align-items: center; justify-content: space-between; padding: 10rpx 0; }
.kv .k { font-size: 25rpx; color: var(--muted); }
.kv .v { font-size: 26rpx; color: var(--fg); font-weight: 600; }

.bullet { font-size: 25rpx; color: var(--muted); line-height: 1.7; margin-top: 6rpx; }

.sec-h { font-size: 28rpx; font-weight: 600; color: var(--fg); margin: 32rpx 4rpx 16rpx; }

.rec { padding: 24rpx 26rpx; margin-bottom: 18rpx; }
.rec-top { display: flex; align-items: center; justify-content: space-between; }
.rec-who { font-size: 28rpx; font-weight: 600; color: var(--fg); }
.rec-meta { display: flex; gap: 14rpx; margin-top: 10rpx; }
.mu { font-size: 23rpx; color: var(--faint); }
.quote { display: block; margin-top: 12rpx; font-size: 24rpx; color: var(--muted); line-height: 1.6; }
</style>
