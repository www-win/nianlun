<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { BirthInfo } from '@nianlun/core'
import { storage } from '../../adapters/storage'

const year = ref('')
const month = ref('')
const day = ref('')
const hour = ref('')          // 空表示不填时辰
const isLunar = ref(false)
const gender = ref<'male' | 'female' | ''>('')

onLoad(() => {
  const b = storage.loadMyBazi()
  if (b) {
    year.value = String(b.year); month.value = String(b.month); day.value = String(b.day)
    hour.value = b.hour != null ? String(b.hour) : ''
    isLunar.value = !!b.isLunar
    gender.value = b.gender ?? ''
  }
})

function save() {
  const y = Number(year.value), m = Number(month.value), d = Number(day.value)
  if (!Number.isInteger(y) || y < 1900 || y > 2100 || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) {
    uni.showToast({ title: '请填写有效的年月日', icon: 'none' }); return
  }
  const b: BirthInfo = { year: y, month: m, day: d }
  if (hour.value !== '') {
    const h = Number(hour.value)
    if (h >= 0 && h <= 23) b.hour = h
  }
  if (isLunar.value) b.isLunar = true
  if (gender.value) b.gender = gender.value
  storage.saveMyBazi(b)
  uni.showToast({ title: '已保存', icon: 'success' })
  setTimeout(() => uni.navigateBack(), 500)
}
</script>

<template>
  <view class="page">
    <view class="card">
      <text class="title">设置我的生辰</text>
      <text class="hint">用于与好友合盘、判断流日相冲。仅存本机，不上传。</text>
      <view class="row"><text class="lbl">出生年</text><input class="inp" type="number" v-model="year" placeholder="如 1990" /></view>
      <view class="row"><text class="lbl">月</text><input class="inp" type="number" v-model="month" placeholder="1-12" /></view>
      <view class="row"><text class="lbl">日</text><input class="inp" type="number" v-model="day" placeholder="1-31" /></view>
      <view class="row"><text class="lbl">时辰(选填)</text><input class="inp" type="number" v-model="hour" placeholder="0-23，不确定可留空" /></view>
      <view class="row"><text class="lbl">按农历</text><switch :checked="isLunar" @change="(e: any) => isLunar = e.detail.value" /></view>
      <view class="row">
        <text class="lbl">性别(选填)</text>
        <view class="seg">
          <text :class="['seg-i', gender === 'male' && 'on']" @click="gender = gender === 'male' ? '' : 'male'">男</text>
          <text :class="['seg-i', gender === 'female' && 'on']" @click="gender = gender === 'female' ? '' : 'female'">女</text>
        </view>
      </view>
      <view class="save" @click="save">保存</view>
    </view>
  </view>
</template>

<style scoped>
.page { padding: 32rpx 28rpx; }
.card { padding: 32rpx 36rpx; }
.title { display: block; font-size: 32rpx; font-weight: 700; color: var(--fg); }
.hint { display: block; margin: 12rpx 0 24rpx; font-size: 23rpx; color: var(--muted); line-height: 1.6; }
.row { display: flex; align-items: center; justify-content: space-between; padding: 18rpx 0; border-top: 1rpx solid var(--border); }
.lbl { font-size: 26rpx; color: var(--muted); }
.inp { flex: 1; margin-left: 24rpx; height: 64rpx; padding: 0 20rpx; font-size: 26rpx; color: var(--fg); background: var(--surface); border: 1rpx solid var(--border-2); border-radius: 12rpx; text-align: right; }
.seg { display: flex; gap: 12rpx; }
.seg-i { padding: 10rpx 28rpx; font-size: 24rpx; border-radius: 999rpx; background: var(--surface-2); color: var(--muted); }
.seg-i.on { background: var(--accent); color: #fff; }
.save { margin-top: 32rpx; height: 80rpx; display: flex; align-items: center; justify-content: center; border-radius: 16rpx; background: var(--accent); color: #fff; font-size: 28rpx; font-weight: 600; }
</style>
