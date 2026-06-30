<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDataStore } from '../../stores/data'
import type { Relation } from '@nianlun/core'
import { aiClient } from '../../adapters/aiClient'
import { samples } from '../../adapters/samples'

const data = useDataStore()
const kw = ref('')
const sortKey = ref<'msgCount' | 'lastContact'>('msgCount')
const RELS: Relation[] = ['家人', '挚友', '同事', '同学', '客户', '其他']

const rows = computed(() => {
  const q = kw.value.trim()
  return data.friends
    .filter((f) => !q || (f.alias || f.name).includes(q))
    .slice()
    .sort((a, b) => (b[sortKey.value] as number) - (a[sortKey.value] as number))
})

function onRel(id: string, e: { detail: { value: number } }) {
  data.updateFriend(id, { rel: RELS[e.detail.value] })
}
function onRole(id: string, e: { detail: { value: string } }) {
  data.updateFriend(id, { role: e.detail.value })
}

async function suggest(f: { id: string }) {
  const s = samples.loadSamplesFor(f.id)
  const ok = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '使用 AI 智能建议',
      content: `将发送约 ${s.length} 条聊天片段到 AI 服务用于推断关系，是否继续？`,
      success: (r) => resolve(r.confirm),
    })
  })
  if (!ok) return
  const friend = data.friends.find((x) => x.id === f.id)
  if (!friend) return
  try {
    const sug = await aiClient.suggestFriend(friend, s)
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
    <input v-model="kw" placeholder="搜索好友" class="search" />
    <view class="sort">
      <text :class="{ on: sortKey === 'msgCount' }" @click="sortKey = 'msgCount'">按消息数</text>
      <text :class="{ on: sortKey === 'lastContact' }" @click="sortKey = 'lastContact'">按最近联系</text>
    </view>
    <view v-for="f in rows" :key="f.id" class="row">
      <view class="name">{{ f.alias || f.name }}</view>
      <view class="meta">{{ f.msgCount }} 条 · {{ f.rel }}</view>
      <picker :range="RELS" @change="(e) => onRel(f.id, e)"><text class="edit">改关系</text></picker>
      <text class="edit" @click="suggest(f)">智能建议</text>
      <input class="role" :value="f.role" placeholder="职务/备注" @blur="(e) => onRole(f.id, e)" />
    </view>
  </view>
</template>

<style>
.page { padding: 24rpx; }
.search { border: 1rpx solid #ddd; padding: 16rpx; border-radius: 12rpx; }
.sort { display: flex; gap: 32rpx; margin: 16rpx 0; color: #888; }
.sort .on { color: #07c160; }
.row { padding: 20rpx 0; border-bottom: 1rpx solid #eee; }
.name { font-weight: 600; }
.meta { color: #888; font-size: 24rpx; }
.edit { color: #576b95; }
.role { border: 1rpx solid #eee; padding: 8rpx; margin-top: 8rpx; }
</style>
