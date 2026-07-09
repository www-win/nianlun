<script setup lang="ts">
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { storage } from '../../adapters/storage'
import { useImportStore } from '../../stores/import'
import { useDataStore } from '../../stores/data'
import { fileReader } from '../../adapters/fileReader'
import { aggregateByStock, aggregateByRecommender, withRecommenderNames } from '@nianlun/core'
import type { StockPick } from '@nianlun/core'
import { sortStockCards, sortRecommenders, stockStats } from '../../lib/stockView'

const imp = useImportStore()
const data = useDataStore()
const picks = ref<StockPick[]>([])
const tab = ref<'stock' | 'person'>('stock')

function reload() { picks.value = storage.loadStockPicks() }
onShow(() => reload())   // 每次进 tab 刷新（分析/别处更新后同步）

// pick 里的推荐人名是「抽取当时」的快照；用好友列表最新名(导入通讯录/改名后)实时覆盖，避免显示成微信id。
const named = computed(() =>
  withRecommenderNames(picks.value, new Map(data.friends.map((f) => [f.id, f.alias || f.name]))),
)
const stats = computed(() => stockStats(named.value))
const cards = computed(() => sortStockCards(aggregateByStock(named.value)))
const people = computed(() => sortRecommenders(aggregateByRecommender(named.value)))

async function onAnalyze() {
  try {
    const files = await fileReader.pickAndRead(500)
    if (!files.length) return
    await imp.analyzeStocks(files)
    reload()
    if (imp.stocksSavedCount) {
      uni.showToast({ title: `已抽取荐股 ${imp.stocksSavedCount} 条`, icon: 'none' })
    } else {
      // 未抽到时把诊断详情(已分析几位/几位失败/错误原因，含云函数或 GACCODE 报的错)弹出来，便于定位
      const detail = imp.warnings[imp.warnings.length - 1] || '未抽到荐股（无更多信息）'
      uni.showModal({ title: '未抽到荐股', content: detail, showCancel: false })
    }
  } catch (e) {
    uni.showModal({ title: '分析失败', content: (e as Error).message || '未知错误', showCancel: false })
  }
}

function openStock(stockNorm: string) {
  uni.navigateTo({ url: `/pages/stock-detail/stock-detail?type=stock&key=${encodeURIComponent(stockNorm)}` })
}
function openPerson(id: string) {
  uni.navigateTo({ url: `/pages/stock-detail/stock-detail?type=person&id=${encodeURIComponent(id)}` })
}
</script>

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

<style scoped>
.page { padding: 32rpx 28rpx 64rpx; }

.head { margin-bottom: 8rpx; }
.head .btn-primary { width: 100%; }
.head .btn-primary[disabled] { opacity: 0.6; }
.hint { display: block; margin-top: 14rpx; font-size: 23rpx; }
.stats { margin-top: 20rpx; font-size: 25rpx; color: var(--muted); font-weight: 600; }

.chips { display: flex; gap: 16rpx; margin: 28rpx 0 20rpx; }
.chip {
  padding: 10rpx 24rpx; border-radius: 999rpx; font-size: 25rpx; font-weight: 550;
  color: var(--muted); background: var(--surface-2); border: 1rpx solid var(--border);
}
.chip.on { color: var(--accent-strong); background: var(--accent-wash); border-color: var(--accent-line); }

.srow { display: flex; align-items: center; padding: 28rpx; margin-bottom: 20rpx; }
.info { flex: 1; min-width: 0; }
.name { font-size: 30rpx; font-weight: 600; color: var(--fg); }
.meta { display: flex; align-items: center; flex-wrap: wrap; gap: 14rpx; margin-top: 8rpx; }
.meta .mu { font-size: 23rpx; color: var(--faint); }
.chevron { flex: none; margin-left: 12rpx; color: var(--faint); font-size: 40rpx; line-height: 1; }
.badge {
  padding: 4rpx 16rpx; border-radius: 999rpx; font-size: 22rpx;
  background: var(--accent-wash); color: var(--accent-strong); font-weight: 600;
}
</style>
