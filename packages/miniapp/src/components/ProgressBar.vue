<script setup lang="ts">
import { computed } from 'vue'
import { resolveProgress } from './progressBar'

const props = defineProps<{ percent?: number; indeterminate?: boolean; label?: string }>()
const view = computed(() => resolveProgress(props))
</script>

<template>
  <view class="pbar-wrap">
    <view class="bar" :class="{ indet: view.mode === 'indeterminate' }">
      <view class="bar-in" :style="view.mode === 'indeterminate' ? undefined : { width: view.width + '%' }"></view>
    </view>
    <text v-if="view.showLabel" class="pbar-label">{{ props.label }}</text>
  </view>
</template>

<style scoped>
.bar { height: 12rpx; border-radius: 999rpx; background: var(--surface-2); overflow: hidden; }
.bar-in { height: 100%; background: var(--accent); border-radius: 999rpx; transition: width .2s; }
/* 不确定态：一段高亮块单向循环扫动。动画跑在渲染线程，逻辑线程阻塞时仍持续滑动。 */
.bar.indet .bar-in { width: 40%; animation: indet 1.1s ease-in-out infinite; }
@keyframes indet {
  0%   { margin-left: -40%; }
  100% { margin-left: 100%; }
}
.pbar-label { display: block; margin-top: 14rpx; font-size: 24rpx; color: var(--muted); }
</style>
