<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDataStore } from '../../stores/data'
import type { Relation } from '@nianlun/core'

const data = useDataStore()
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

const rows = computed(() => {
  const q = kw.value.trim()
  return data.friends
    .filter((f) => !q || f.name.includes(q) || (f.alias || '').includes(q))
    .slice()
    .sort((a, b) => (b[sortKey.value] as number) - (a[sortKey.value] as number))
})

function onRel(id: string, e: { detail: { value: number } }) {
  data.updateFriend(id, { rel: RELS[e.detail.value] })
}
function onRole(id: string, e: { detail: { value: string } }) {
  data.updateFriend(id, { role: e.detail.value })
}
</script>

<template>
  <view class="page">
    <view v-if="!data.friends.length" class="empty">
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

      <text class="count faint">共 {{ rows.length }} 位好友</text>

      <view v-for="f in rows" :key="f.id" class="card frow">
        <view class="top" @click="openDetail(f.id)">
          <view class="avatar" :style="{ background: relColor(f.rel) }">{{ initials(f.alias || f.name) }}</view>
          <view class="info">
            <text class="name">{{ f.alias || f.name }}</text>
            <view class="meta">
              <text class="num">{{ f.msgCount }}</text><text class="mu"> 条</text>
              <view class="tag" :style="{ background: relColor(f.rel) }">{{ f.rel }}</view>
              <text v-if="f.role" class="role-tag">{{ f.role }}</text>
            </view>
          </view>
          <text class="chevron">›</text>
        </view>
        <view class="acts">
          <picker class="act" :range="RELS" @change="(e) => onRel(f.id, e)">
            <text class="act-t">改关系</text>
          </picker>
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
  flex: none; width: 84rpx; height: 84rpx; border-radius: 24rpx; margin-right: 22rpx;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 28rpx; font-weight: 600;
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
.role-input {
  flex: 1; min-width: 160rpx; height: 60rpx; padding: 0 18rpx;
  font-size: 24rpx; color: var(--fg);
  background: var(--surface); border: 1rpx solid var(--border-2); border-radius: 12rpx;
}
</style>
