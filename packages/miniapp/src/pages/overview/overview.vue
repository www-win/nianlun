<script setup lang="ts">
import { computed } from 'vue'
import { useDataStore } from '../../stores/data'
const data = useDataStore()
const cards = computed(() => {
  const r = data.report
  if (!r) return []
  return [
    { label: '好友数', value: r.friendCount },
    { label: '全年消息', value: r.totalMessages },
    { label: '活跃天数', value: r.activeDays },
  ]
})
</script>

<template>
  <view class="page">
    <view v-if="!data.report" class="empty">还没有数据，请先到「导入」页导入。</view>
    <view v-else class="grid">
      <view v-for="c in cards" :key="c.label" class="card">
        <view class="num">{{ c.value }}</view>
        <view class="lbl">{{ c.label }}</view>
      </view>
    </view>
  </view>
</template>

<style>
.page { padding: 32rpx; }
.grid { display: flex; flex-wrap: wrap; gap: 24rpx; }
.card { width: 200rpx; padding: 32rpx; background: #f7f7f7; border-radius: 16rpx; text-align: center; }
.num { font-size: 48rpx; font-weight: 700; }
.lbl { color: #888; margin-top: 8rpx; }
.empty { color: #888; }
</style>
