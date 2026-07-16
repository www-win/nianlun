<script setup lang="ts">
import { useDataStore } from '../../stores/data'
import { useBackupStore } from '../../stores/backup'
import ProgressBar from '../../components/ProgressBar.vue'

const data = useDataStore()
const backup = useBackupStore()

async function onBackup() {
  await backup.backupNow()
  uni.showToast({
    title: backup.status === 'error' ? '备份失败' : '已备份',
    icon: backup.status === 'error' ? 'none' : 'success',
  })
}
function onRestore() {
  uni.showModal({
    title: '从云端恢复', content: '将从云端备份写回本机数据（本地已有的会被云端版本覆盖），确定吗？',
    success: async (r) => {
      if (!r.confirm) return
      const ok = await backup.restoreNow()
      if (ok) { await data.hydrate(); uni.showToast({ title: '已恢复', icon: 'success' }) }
      else uni.showToast({ title: '云端暂无备份', icon: 'none' })
    },
  })
}
</script>

<template>
  <view class="page">
    <view class="card sec">
      <view class="eyebrow">数据与备份</view>
      <view class="muted at">
        {{ backup.lastBackupAt ? '上次备份：' + new Date(backup.lastBackupAt).toLocaleString() : '尚未备份' }}
      </view>
      <view class="btns">
        <button class="btn-primary" style="flex:1" :loading="backup.status==='backing'" @click="onBackup">立即备份到云</button>
        <button class="btn-ghost" style="flex:1" :loading="backup.status==='restoring'" @click="onRestore">从云端恢复</button>
      </view>
      <ProgressBar
        v-if="backup.status === 'backing' || backup.status === 'restoring'"
        indeterminate
        :label="backup.status === 'backing' ? '正在备份到云…' : '正在从云端恢复…'" />
      <view class="tip faint">
        备份「只增不减」，不会破坏云端已有数据。数据仅存于你的设备与你自己的微信云，不上传任何第三方。
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { padding: 40rpx 36rpx 64rpx; }
.sec { padding: 32rpx 36rpx; }
.at { margin: 12rpx 0 20rpx; }
.btns { display: flex; gap: 16rpx; }
.tip { margin-top: 24rpx; font-size: 22rpx; line-height: 1.6; }
</style>
