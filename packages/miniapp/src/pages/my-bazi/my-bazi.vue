<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { BirthInfo } from '@nianlun/core'
import { storage } from '../../adapters/storage'
import { useBackupStore } from '../../stores/backup'
import { SHICHEN_LABELS, shichenIndexToHour, hourToShichenIndex, toDateStr, fromDateStr } from '../../lib/birthPicker'

const dateStr = ref('')       // "YYYY-MM-DD"，空表示未填
const shichenIdx = ref(0)     // 0=不确定，1..12 对应十二时辰
const isLunar = ref(false)
const gender = ref<'male' | 'female' | ''>('')

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

onLoad(() => {
  const b = storage.loadMyBazi()
  if (b) {
    dateStr.value = toDateStr(b.year, b.month, b.day)
    shichenIdx.value = hourToShichenIndex(b.hour)
    isLunar.value = !!b.isLunar
    gender.value = b.gender ?? ''
  }
})

function onDateChange(e: any) { dateStr.value = e.detail.value }
function onShichenChange(e: any) { shichenIdx.value = Number(e.detail.value) }

function save() {
  const parsed = fromDateStr(dateStr.value)
  if (!parsed) { uni.showToast({ title: '请选择出生日期', icon: 'none' }); return }
  const { year: y, month: m, day: d } = parsed
  if (y < 1900 || y > 2100 || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) {
    uni.showToast({ title: '请填写有效的出生日期', icon: 'none' }); return
  }
  const b: BirthInfo = { year: y, month: m, day: d }
  const h = shichenIndexToHour(shichenIdx.value)
  if (h !== undefined) b.hour = h
  if (isLunar.value) b.isLunar = true
  if (gender.value) b.gender = gender.value
  storage.saveMyBazi(b)
  // 触发云备份：生辰只存本地会被微信清空/换机丢失，须同步到云端才能"设一次就好"
  useBackupStore().scheduleBackup()
  uni.showToast({ title: '已保存', icon: 'success' })
  setTimeout(() => uni.navigateBack(), 500)
}
</script>

<template>
  <view class="page">
    <view class="card">
      <text class="title">设置我的生辰</text>
      <text class="hint">用于与好友合盘、判断流日相冲。仅存本机，不上传。</text>
      <view class="row">
        <text class="lbl">出生日期</text>
        <picker mode="date" :value="dateStr || '2000-01-01'" start="1900-01-01" :end="todayStr()" @change="onDateChange">
          <view class="inp picker-disp">{{ dateStr || '请选择' }}</view>
        </picker>
      </view>
      <view class="row">
        <text class="lbl">时辰(选填)</text>
        <picker :range="SHICHEN_LABELS" :value="shichenIdx" @change="onShichenChange">
          <view class="inp picker-disp">{{ SHICHEN_LABELS[shichenIdx] }}</view>
        </picker>
      </view>
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
.picker-disp { display: flex; align-items: center; justify-content: flex-end; box-sizing: border-box; }
.seg { display: flex; gap: 12rpx; }
.seg-i { padding: 10rpx 28rpx; font-size: 24rpx; border-radius: 999rpx; background: var(--surface-2); color: var(--muted); }
.seg-i.on { background: var(--accent); color: #fff; }
.save { margin-top: 32rpx; height: 80rpx; display: flex; align-items: center; justify-content: center; border-radius: 16rpx; background: var(--accent); color: #fff; font-size: 28rpx; font-weight: 600; }
</style>
