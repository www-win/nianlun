<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useDataStore } from '../../stores/data'
import { aiClient } from '../../adapters/aiClient'

const data = useDataStore()

const copy = ref('')
const loadingCopy = ref(false)
async function genCopy() {
  if (!data.report) return
  loadingCopy.value = true
  try { copy.value = await aiClient.generateReportCopy(data.report, data.friends) }
  catch (e) { uni.showToast({ title: (e as Error).message, icon: 'none' }) }
  finally { loadingCopy.value = false }
}

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
    fail: () => uni.showToast({ title: '生成图片失败，请重试', icon: 'none' }),
  })
}

onMounted(draw)
</script>

<template>
  <view class="page">
    <view v-if="!data.report" class="empty">还没有数据，请先导入。</view>
    <template v-else>
      <button size="mini" :loading="loadingCopy" @click="genCopy">AI 生成年度文案</button>
      <view v-if="copy" class="copy">{{ copy }}</view>
      <canvas canvas-id="poster" style="width: 320px; height: 480px;" />
      <button type="primary" @click="save">保存到相册</button>
    </template>
  </view>
</template>

<style>
.page { padding: 24rpx; }
.empty { color: #888; }
</style>
