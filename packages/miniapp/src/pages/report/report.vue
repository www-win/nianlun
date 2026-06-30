<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useDataStore } from '../../stores/data'
import { aiClient } from '../../adapters/aiClient'

const data = useDataStore()
const report = computed(() => data.report)

const copy = ref('')
const loadingCopy = ref(false)

async function genCopy() {
  if (!report.value) return
  loadingCopy.value = true
  try {
    copy.value = await aiClient.generateReportCopy(report.value, data.friends)
    draw()
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loadingCopy.value = false
  }
}

// 离屏 canvas 尺寸（用于出图存相册）。
const CW = 600
const CH = 860

function wrapLines(ctx: any, text: string, maxW: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const ch of text) {
    if (ch === '\n') { lines.push(line); line = ''; continue }
    const test = line + ch
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = ch }
    else line = test
  }
  if (line) lines.push(line)
  return lines
}

function draw() {
  const r = report.value
  if (!r) return
  const ctx = uni.createCanvasContext('poster')
  // 背景
  ctx.setFillStyle('#faf6ef'); ctx.fillRect(0, 0, CW, CH)
  // 细描边
  ctx.setStrokeStyle('#e7dcc8'); ctx.setLineWidth(2)
  ctx.strokeRect(24, 24, CW - 48, CH - 48)

  ctx.setTextAlign('left')
  ctx.setFillStyle('#0b7d5d'); ctx.setFontSize(22)
  ctx.fillText('年轮 · NIANLUN', 56, 96)

  ctx.setFillStyle('#3a3632'); ctx.setFontSize(120)
  ctx.fillText(String(r.year), 52, 230)
  ctx.setFontSize(30); ctx.setFillStyle('#6b655c')
  ctx.fillText('年度社交报告', 56, 286)

  ctx.setStrokeStyle('#e7dcc8'); ctx.setLineWidth(1)
  ctx.beginPath(); ctx.moveTo(56, 330); ctx.lineTo(CW - 56, 330); ctx.stroke()

  const stats = [
    [String(r.friendCount), '位好友'],
    [String(r.totalMessages), '条消息'],
    [String(r.activeDays), '天活跃'],
  ]
  let sx = 56
  stats.forEach(([v, l]) => {
    ctx.setFillStyle('#10a37a'); ctx.setFontSize(56)
    ctx.fillText(v, sx, 410)
    ctx.setFillStyle('#6b655c'); ctx.setFontSize(24)
    ctx.fillText(l, sx, 448)
    sx += 176
  })

  if (copy.value) {
    ctx.setFillStyle('#4a443c'); ctx.setFontSize(28)
    const lines = wrapLines(ctx, copy.value, CW - 112)
    let y = 520
    for (const ln of lines.slice(0, 8)) { ctx.fillText(ln, 56, y); y += 46 }
  }

  ctx.setFillStyle('#9a917f'); ctx.setFontSize(22)
  ctx.fillText('本地生成 · 数据从未离开你的手机', 56, CH - 60)
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
    <view v-if="!report" class="empty">
      <view class="e-icon">📄</view>
      <view class="e-text">还没有数据，先到「导入」页导入聊天记录</view>
    </view>

    <template v-else>
      <view class="poster">
        <text class="p-brand">年轮 · NIANLUN</text>
        <text class="p-year num">{{ report.year }}</text>
        <text class="p-sub">年度社交报告</text>
        <view class="p-divider"></view>
        <view class="p-stats">
          <view class="p-stat">
            <text class="pv num">{{ report.friendCount }}</text><text class="pl">位好友</text>
          </view>
          <view class="p-stat">
            <text class="pv num">{{ report.totalMessages }}</text><text class="pl">条消息</text>
          </view>
          <view class="p-stat">
            <text class="pv num">{{ report.activeDays }}</text><text class="pl">天活跃</text>
          </view>
        </view>
        <text v-if="copy" class="p-copy">{{ copy }}</text>
        <text v-else class="p-copy ph">点下方「生成年度文案」，让 AI 为这一年写句话…</text>
        <text class="p-foot">本地生成 · 数据从未离开你的手机</text>
      </view>

      <view class="actions">
        <view class="btn-ghost half" hover-class="g-hover" @click="genCopy">
          {{ loadingCopy ? '生成中…' : '✦ 生成年度文案' }}
        </view>
        <view class="btn-primary half" hover-class="hover" @click="save">保存到相册</view>
      </view>
    </template>

    <!-- 离屏 canvas：仅用于出图存相册 -->
    <canvas
      canvas-id="poster"
      class="offscreen"
      :style="{ width: CW + 'px', height: CH + 'px' }"
    />
  </view>
</template>

<style scoped>
.page { padding: 40rpx 36rpx 64rpx; }

.poster {
  display: flex; flex-direction: column;
  padding: 48rpx 44rpx 40rpx;
  background: var(--cream);
  border: 1rpx solid var(--cream-2);
  border-radius: 32rpx;
  box-shadow: 0 8rpx 30rpx rgba(120, 96, 50, 0.10);
}
.p-brand { font-size: 24rpx; font-weight: 600; letter-spacing: 0.14em; color: var(--accent-strong); }
.p-year { font-size: 132rpx; font-weight: 700; line-height: 1.05; color: var(--ink); margin-top: 8rpx; }
.p-sub { font-size: 30rpx; color: #6b655c; margin-top: 4rpx; }
.p-divider { height: 1rpx; background: var(--cream-2); margin: 32rpx 0; }
.p-stats { display: flex; }
.p-stat { flex: 1; display: flex; flex-direction: column; }
.pv { font-size: 60rpx; font-weight: 700; color: var(--accent); line-height: 1.1; }
.pl { font-size: 24rpx; color: #6b655c; margin-top: 4rpx; }
.p-copy { margin-top: 36rpx; font-size: 29rpx; line-height: 1.85; color: #4a443c; }
.p-copy.ph { color: #b3a98f; }
.p-foot { margin-top: 40rpx; font-size: 22rpx; color: #a99f88; }

.actions { display: flex; gap: 20rpx; margin-top: 32rpx; }
.half { flex: 1; }
.g-hover { background: var(--surface-2); }

.offscreen { position: fixed; left: -9999px; top: 0; }
</style>
