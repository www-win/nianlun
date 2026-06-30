<script setup lang="ts">
import { ref } from 'vue'
import { fileReader } from '../../adapters/fileReader'
import { useImportStore } from '../../stores/import'
import { useDataStore } from '../../stores/data'

const imp = useImportStore()
const data = useDataStore()
const showHelp = ref(false)

// 报告年份（仅作报告标题用，不影响统计口径）。默认当年，可下拉选。
const years = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i)
const yearIdx = ref(0)
const year = ref(years[0])
function onYear(e: { detail: { value: number } }) {
  yearIdx.value = Number(e.detail.value)
  year.value = years[yearIdx.value]
}

async function onImport() {
  const files = await fileReader.pickAndRead(10)
  if (!files.length) return
  await imp.run(files, year.value)
}
</script>

<template>
  <view class="page">
    <picker mode="selector" :range="years" :value="yearIdx" @change="onYear">
      <view class="year">报告年份：{{ year }} ▾</view>
    </picker>
    <button type="primary" @click="onImport">从文件传输助手导入</button>
    <view v-if="imp.status === 'parsing'">解析中… {{ Math.round(imp.progress * 100) }}%</view>
    <view v-if="imp.status === 'done'">已导入，好友 {{ data.friends.length }} 位，告警 {{ imp.warnings.length }} 条</view>
    <view v-if="imp.status === 'error'" class="err">导入失败：{{ imp.error }}</view>

    <view class="help-toggle" @click="showHelp = !showHelp">如何导出？</view>
    <view v-if="showHelp" class="help">
      <view>① 手机微信 → 设置 → 通用 → 聊天记录迁移与备份 → 迁移到电脑微信</view>
      <view>② 电脑上用 WeFlow / WeLive 导出 CSV / JSON</view>
      <view>③ 把导出文件发到「文件传输助手」</view>
      <view>④ 回到这里点「从文件传输助手导入」，选中该文件</view>
    </view>
  </view>
</template>

<style>
.page { padding: 32rpx; }
.year { margin-bottom: 24rpx; color: #333; font-size: 30rpx; }
.help-toggle { margin-top: 40rpx; color: #576b95; }
.help { margin-top: 16rpx; color: #888; line-height: 1.8; }
.err { color: #e64340; }
</style>
