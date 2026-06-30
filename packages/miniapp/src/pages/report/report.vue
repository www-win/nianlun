<script setup lang="ts">
import { onMounted } from 'vue'
import { useDataStore } from '../../stores/data'

const data = useDataStore()

function draw() {
  const r = data.report
  if (!r) return
  const ctx = uni.createCanvasContext('poster')
  ctx.setFillStyle('#faf6ef'); ctx.fillRect(0, 0, 320, 480)
  ctx.setFillStyle('#333'); ctx.setFontSize(24)
  ctx.fillText(`${r.year} 年度报告`, 24, 60)
  ctx.setFontSize(16)
  ctx.fillText(`好友 ${r.friendCount} 位`, 24, 120)
  ctx.fillText(`全年消息 ${r.totalMessages} 条`, 24, 160)
  ctx.fillText(`活跃 ${r.activeDays} 天`, 24, 200)
  ctx.draw()
}

function save() {
  uni.canvasToTempFilePath({
    canvasId: 'poster',
    success: (res: { tempFilePath: string }) => {
      uni.saveImageToPhotosAlbum({
        filePath: res.tempFilePath,
        success: () => uni.showToast({ title: '已保存到相册' }),
        fail: () => uni.showToast({ title: '保存失败，请授权相册', icon: 'none' }),
      })
    },
  })
}

onMounted(draw)
</script>

<template>
  <view class="page">
    <view v-if="!data.report" class="empty">还没有数据，请先导入。</view>
    <template v-else>
      <canvas canvas-id="poster" style="width: 320px; height: 480px;" />
      <button type="primary" @click="save">保存到相册</button>
    </template>
  </view>
</template>

<style>
.page { padding: 24rpx; }
.empty { color: #888; }
</style>
