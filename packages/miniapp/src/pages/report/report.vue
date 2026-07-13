<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useDataStore } from '../../stores/data'
import { useBackupStore } from '../../stores/backup'
import { aiClient } from '../../adapters/aiClient'
import { samples } from '../../adapters/samples'
import { storage } from '../../adapters/storage'
import AntennaBuddy from '../../components/AntennaBuddy.vue'
import SunBaby from '../../components/SunBaby.vue'
import GrassHills from '../../components/GrassHills.vue'
import ProgressBar from '../../components/ProgressBar.vue'

const data = useDataStore()
const backup = useBackupStore()
const report = computed(() => data.report)

const copy = ref('')
const copyStale = ref(false)
const loadingCopy = ref(false)

const mood = ref('')
const moodStale = ref(false)
const loadingMood = ref(false)
async function genMood() {
  if (!report.value) return
  const lines = samples.gatherTopSamples(data.friends)
  const ok = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: 'AI 全年情绪',
      content: `将发送约 ${lines.length} 条聊天片段到 AI 服务分析全年情绪，是否继续？`,
      success: (r) => resolve(r.confirm),
    })
  })
  if (!ok) return
  loadingMood.value = true
  try {
    mood.value = await aiClient.analyzeYearSentiment(report.value, lines)
    storage.saveYearMood(report.value, mood.value)
    moodStale.value = false
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loadingMood.value = false
  }
}

async function genCopy() {
  if (!report.value) return
  loadingCopy.value = true
  try {
    copy.value = await aiClient.generateReportCopy(report.value, data.friends)
    storage.saveReportCopy(report.value, copy.value)
    copyStale.value = false
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
  ctx.setFillStyle('#fffdf6'); ctx.fillRect(0, 0, CW, CH)
  // 细描边
  ctx.setStrokeStyle('#f3ead3'); ctx.setLineWidth(2)
  ctx.strokeRect(24, 24, CW - 48, CH - 48)

  ctx.setTextAlign('left')
  ctx.setFillStyle('#2ea34a'); ctx.setFontSize(22)
  ctx.fillText('天线宝宝 · TELETUBBIES', 56, 96)

  ctx.setFillStyle('#3a3632'); ctx.setFontSize(120)
  ctx.fillText(String(r.year), 52, 230)
  ctx.setFontSize(30); ctx.setFillStyle('#6b655c')
  ctx.fillText('年度社交报告', 56, 286)

  ctx.setStrokeStyle('#f3ead3'); ctx.setLineWidth(1)
  ctx.beginPath(); ctx.moveTo(56, 330); ctx.lineTo(CW - 56, 330); ctx.stroke()

  const stats = [
    [String(r.friendCount), '位好友'],
    [String(r.totalMessages), '条消息'],
    [String(r.activeDays), '天活跃'],
  ]
  let sx = 56
  stats.forEach(([v, l]) => {
    ctx.setFillStyle('#43c463'); ctx.setFontSize(56)
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

  // 底部草坡（三段圆弧）
  const hillY = CH - 130
  const hills = [['#7fd694', 120, 90], ['#43c463', 300, 100], ['#5fc47a', 470, 84]]
  hills.forEach(([c, cx, r]) => {
    ctx.setFillStyle(c); ctx.beginPath()
    ctx.arc(cx, hillY + 60, r, Math.PI, 2 * Math.PI); ctx.fill()
  })
  // 太阳
  ctx.setFillStyle('#ffcf33'); ctx.beginPath(); ctx.arc(CW - 90, 150, 30, 0, 2 * Math.PI); ctx.fill()
  // 四色小人（圆身 + 天线杆）
  const buddies = [['#a97be0', 180], ['#43c463', 270], ['#ffd23f', 360], ['#ff6b6b', 450]]
  buddies.forEach(([c, bx]) => {
    ctx.setStrokeStyle('#6b6b6b'); ctx.setLineWidth(3)
    ctx.beginPath(); ctx.moveTo(bx, hillY - 16); ctx.lineTo(bx, hillY - 44); ctx.stroke()
    ctx.setFillStyle(c); ctx.beginPath(); ctx.arc(bx, hillY + 6, 22, 0, 2 * Math.PI); ctx.fill()
  })

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

// 进页装载已持久化的文案/全年情绪缓存：命中直显（文案命中则出图），过期打标不重算。
onMounted(() => {
  const r = report.value
  if (r) {
    const c = storage.loadReportCopy(r)
    if (c) { copy.value = c.data; copyStale.value = c.stale }
    const m = storage.loadYearMood(r)
    if (m) { mood.value = m.data; moodStale.value = m.stale }
  }
  draw()
})
</script>

<template>
  <view class="page">
    <view v-if="!report && backup.status === 'restoring'" class="page-loading">
      <ProgressBar indeterminate label="正在从云端恢复数据…" />
    </view>
    <view v-else-if="!report" class="empty">
      <view class="e-icon">📄</view>
      <view class="e-text">还没有数据，先到「导入」页导入聊天记录</view>
    </view>

    <template v-else>
      <view class="poster">
        <text class="p-brand">天线宝宝 · TELETUBBIES</text>
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
        <view class="p-scene">
          <SunBaby class="p-sun" :size="72" />
          <view class="p-buddies">
            <AntennaBuddy :color="'var(--tinky)'" antenna="triangle" :scale="0.5" />
            <AntennaBuddy :color="'var(--dipsy)'" antenna="rod" :scale="0.58" />
            <AntennaBuddy :color="'var(--laa)'" antenna="curl" :scale="0.58" />
            <AntennaBuddy :color="'var(--po)'" antenna="ring" :scale="0.5" />
          </view>
          <GrassHills :height="72" />
        </view>
        <text class="p-foot">本地生成 · 数据从未离开你的手机</text>
      </view>

      <view class="actions">
        <view class="btn-ghost half" hover-class="g-hover" @click="genCopy">
          {{ loadingCopy ? '生成中…' : '✦ 生成年度文案' }}
        </view>
        <view class="btn-primary half" hover-class="hover" @click="save">保存到相册</view>
      </view>
      <text v-if="copyStale" class="stale-hint" @click="genCopy">数据已更新，点「生成年度文案」刷新</text>

      <view class="card mood">
        <view class="mood-head">
          <text class="mood-t">全年情绪</text>
          <text class="mood-btn" @click="genMood">{{ loadingMood ? '分析中…' : '✦ AI 分析' }}</text>
        </view>
        <text v-if="moodStale" class="stale-hint" @click="genMood">数据已更新，点「AI 分析」刷新</text>
        <text v-if="mood" class="mood-body">{{ mood }}</text>
        <text v-else class="mood-body ph">点右上「AI 分析」，让 AI 说说你这一年的社交情绪基调</text>
        <text v-if="mood" class="mood-note faint">AI 推测，仅供参考</text>
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
.page-loading { margin-top: 200rpx; }

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
.p-scene { position: relative; margin-top: 32rpx; }
.p-sun { position: absolute; top: -8rpx; right: 8rpx; }
.p-buddies { display: flex; align-items: flex-end; justify-content: center; gap: 2rpx; height: 96rpx; }

.actions { display: flex; gap: 20rpx; margin-top: 32rpx; }
.half { flex: 1; }
.g-hover { background: var(--surface-2); }

.mood { margin-top: 24rpx; padding: 32rpx 36rpx; }
.mood-head { display: flex; align-items: center; justify-content: space-between; }
.mood-t { font-size: 28rpx; font-weight: 600; color: var(--fg); }
.mood-btn { padding: 10rpx 22rpx; border-radius: 12rpx; background: var(--accent-wash); color: var(--accent-strong); font-size: 24rpx; font-weight: 550; }
.mood-body { display: block; margin-top: 20rpx; font-size: 28rpx; line-height: 1.85; color: var(--fg); }
.mood-body.ph { color: var(--faint); font-size: 26rpx; }
.mood-note { display: block; margin-top: 14rpx; font-size: 21rpx; }

.stale-hint { display: block; margin-top: 16rpx; padding: 10rpx 18rpx; font-size: 22rpx; color: #b8860b; background: rgba(184,134,11,0.1); border-radius: 10rpx; }

.offscreen { position: fixed; left: -9999px; top: 0; }
</style>
