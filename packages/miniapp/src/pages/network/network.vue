<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Relation } from '@nianlun/core'
import { useDataStore } from '../../stores/data'
import { egoLayout } from '../../lib/egoLayout'

const data = useDataStore()

const RELATIONS: Relation[] = ['家人', '挚友', '同事', '同学', '客户', '其他']
const REL_COLORS: Record<string, string> = {
  家人: '#d96a5a', 挚友: '#43a86a', 同事: '#5a7fd0', 同学: '#cf9a36', 客户: '#b066b0', 其他: '#8a8f99',
}
const relColor = (r: string) => REL_COLORS[r] || '#8a8f99'

// 画面边长（rpx）；布局坐标也用 rpx。
const SIZE = 690

// 关系筛选：默认全开
const active = ref<Set<Relation>>(new Set(RELATIONS))
function toggle(rel: Relation) {
  const s = new Set(active.value)
  if (s.has(rel)) s.delete(rel); else s.add(rel)
  // 至少留一个，避免空图
  if (s.size > 0) active.value = s
}

const nodes = computed(() => egoLayout(data.friends, SIZE, { activeRels: active.value, topN: 30 }))

function openDetail(id: string) {
  uni.navigateTo({ url: `/pages/friend-detail/friend-detail?id=${encodeURIComponent(id)}` })
}
</script>

<template>
  <view class="page">
    <view v-if="!data.friends.length" class="empty">
      <view class="e-icon">🕸️</view>
      <view class="e-text">还没有好友数据，先到「导入」页导入</view>
    </view>

    <template v-else>
      <view class="chips">
        <text
          v-for="r in RELATIONS" :key="r"
          class="chip" :class="{ on: active.has(r) }"
          :style="active.has(r) ? { background: relColor(r), borderColor: relColor(r), color: '#fff' } : {}"
          @click="toggle(r)"
        >{{ r }}</text>
      </view>

      <movable-area class="area" :style="{ height: SIZE + 'rpx' }" scale-area>
        <movable-view
          class="graph"
          direction="all" inertia scale scale-min="0.6" scale-max="3"
          :style="{ width: SIZE + 'rpx', height: SIZE + 'rpx' }"
        >
          <!-- 关系环参考圈 -->
          <view class="ring ring1"></view>
          <view class="ring ring2"></view>
          <!-- 中心「我」 -->
          <view class="me">我</view>
          <!-- 好友节点 -->
          <view
            v-for="n in nodes" :key="n.id"
            class="node"
            :style="{ left: n.x + 'rpx', top: n.y + 'rpx' }"
            @click="openDetail(n.id)"
          >
            <view class="dot" :style="{ width: (n.r * 2) + 'rpx', height: (n.r * 2) + 'rpx', background: n.color }"></view>
            <text class="nlabel">{{ n.name.slice(0, 4) }}</text>
          </view>
        </movable-view>
      </movable-area>

      <text class="hint faint">以你为中心 · 单指拖动 · 双指缩放 · 点圆点看详情（显示往来最多的 30 位）</text>
    </template>
  </view>
</template>

<style scoped>
.page { padding: 28rpx 24rpx 64rpx; }

.chips { display: flex; flex-wrap: wrap; gap: 14rpx; margin-bottom: 20rpx; }
.chip {
  padding: 8rpx 22rpx; border-radius: 999rpx; font-size: 24rpx; font-weight: 550;
  color: var(--muted); background: var(--surface-2); border: 1rpx solid var(--border);
}

.area {
  position: relative; width: 100%;
  background: var(--surface); border: 1rpx solid var(--border);
  border-radius: 24rpx; overflow: hidden;
}
.graph { position: relative; }
.ring { position: absolute; border-radius: 50%; border: 1rpx dashed var(--border-2); }
.ring1 { inset: 4%; }
.ring2 { inset: 20%; }
.me {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 120rpx; height: 120rpx; border-radius: 50%;
  background: var(--accent); color: #fff; font-size: 32rpx; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6rpx 18rpx rgba(16, 163, 122, 0.3);
}
.node { position: absolute; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; }
.dot { border-radius: 50%; box-shadow: 0 2rpx 6rpx rgba(0, 0, 0, 0.12); }
.nlabel { margin-top: 4rpx; font-size: 18rpx; color: var(--muted); max-width: 120rpx; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }

.hint { display: block; margin-top: 24rpx; text-align: center; font-size: 22rpx; line-height: 1.6; }
</style>
