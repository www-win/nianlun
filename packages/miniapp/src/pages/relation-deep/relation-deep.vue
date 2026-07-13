<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { onLoad, onReady, onShow } from '@dcloudio/uni-app'
import { useDataStore } from '../../stores/data'
import { aiClient } from '../../adapters/aiClient'
import { samples } from '../../adapters/samples'
import { storage } from '../../adapters/storage'
import { moodDualLinePoints } from '../../lib/insights'
import type { RelationDeep } from '@nianlun/core'

const data = useDataStore()
const id = ref('')
onLoad((q) => { id.value = decodeURIComponent((q?.id as string) || '') })
const friend = computed(() => data.friends.find((f) => f.id === id.value) || null)
const displayName = computed(() => (friend.value ? (friend.value.alias || friend.value.name) : ''))

const deep = ref<RelationDeep | null>(null)
const stale = ref(false)
const loading = ref(false)

function loadCache() {
  const f = friend.value
  if (!f) return
  const d = storage.loadRelationDeep(f.id, f)
  if (d) { deep.value = d.data; stale.value = d.stale }
}

async function generate() {
  const f = friend.value
  if (!f || loading.value) return
  const s = samples.loadSamplesFor(f.id)
  const ok = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '深度关系分析',
      content: `将发送约 ${s.length} 条聊天片段到 AI 服务做心理分析，是否继续？`,
      success: (r) => resolve(r.confirm),
    })
  })
  if (!ok) return
  loading.value = true
  try {
    const r = await aiClient.analyzeRelationDeep(f, s)
    if (Object.keys(r).length > 0) {
      deep.value = r
      storage.saveRelationDeep(f.id, f, r)   // 仅有效结果落盘
      stale.value = false
      nextTick(drawSecurity)
    } else {
      deep.value = { overall: 'AI 无法生成深度关系分析' } // 空结果不写盘，允许重试
    }
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loading.value = false
  }
}

// 安全感/信任曲线：复用本地已算好的逐月情绪(friend.emotion.monthly) + 现有 moodDualLinePoints，
// 画「我(暖)/对方(冷)」双线（沿用 friend-detail drawMood 套路）。无逐月情绪数据则不显示图。
const hasSecurityChart = computed(() => {
  const m = friend.value?.emotion?.monthly
  return !!m && moodDualLinePoints(m, { width: 300, height: 150, pad: 20 }).hasData
})
function drawSecurity() {
  const monthly = friend.value?.emotion?.monthly
  if (!monthly || !hasSecurityChart.value) return
  uni.createSelectorQuery().select('.sec-canvas').boundingClientRect((res) => {
    const rect = res as UniApp.NodeInfo
    const W = rect && rect.width ? rect.width : 300
    const H = rect && rect.height ? rect.height : 120
    const pad = 16
    const dl = moodDualLinePoints(monthly, { width: W, height: H, pad })
    const ctx = uni.createCanvasContext('secLine')
    const midY = H - pad - 0.5 * (H - 2 * pad)
    ctx.beginPath(); ctx.setStrokeStyle('#e5e7eb'); ctx.setLineWidth(1)
    ctx.moveTo(pad, midY); ctx.lineTo(W - pad, midY); ctx.stroke()
    const drawLine = (pts: typeof dl.me, color: string) => {
      ctx.setStrokeStyle(color); ctx.setLineWidth(2)
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].m - pts[i - 1].m !== 1) continue
        ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke()
      }
      for (const p of pts) { ctx.beginPath(); ctx.setFillStyle(color); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill() }
    }
    drawLine(dl.me, '#e8a04b')     // 我=暖
    drawLine(dl.them, '#5a8fd0')   // TA=冷
    ctx.draw()
  }).exec()
}

onShow(() => { loadCache(); nextTick(drawSecurity) })
onReady(() => { setTimeout(drawSecurity, 80) })

// ── 长海报导出：动态高度，逐块「彩色标题 + 折行正文」 ──
const CW = 640
const CH = ref(900)   // 动态，measure 后回填

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

// 把 deep 摊平成 [{title, body}] 段落序列（有值才进）。
function posterSegments(): { title: string; body: string }[] {
  const d = deep.value
  if (!d) return []
  const segs: { title: string; body: string }[] = []
  const push = (title: string, body?: string) => { if (body && body.trim()) segs.push({ title, body }) }
  push('整体评估', d.overall)
  if (d.attachment?.me) push('依恋 · 我', `${d.attachment.me.style ?? ''} ${d.attachment.me.desc ?? ''}`)
  if (d.attachment?.other) push('依恋 · 对方', `${d.attachment.other.style ?? ''} ${d.attachment.other.desc ?? ''}`)
  push('沟通主动性', d.interaction?.initiative)
  push('情感表达', d.interaction?.expression)
  push('冲突处理', d.interaction?.conflict)
  push('我的需求', d.needs?.me)
  push('对方的需求', d.needs?.other)
  push('共同记忆', d.uniqueness?.sharedMemory)
  push('互动仪式', d.uniqueness?.ritual)
  push('安全感/信任', d.security?.summary)
  push('权力/主导权', d.power?.summary)
  for (const t of d.triggers?.me ?? []) push('我的雷区', `${t.trigger ?? ''} → ${t.reaction ?? ''}`)
  for (const t of d.triggers?.other ?? []) push('对方雷区', `${t.trigger ?? ''} → ${t.reaction ?? ''}`)
  const lang = d.language
  if (lang) push('沟通语言', [lang.appellation, lang.catchphrases, lang.emoji, lang.latency].filter(Boolean).join('｜'))
  for (const s of d.suggestions ?? []) push(`建议 · ${s.topic ?? ''}`, [s.problem && `问题：${s.problem}`, s.advice && `建议：${s.advice}`].filter(Boolean).join('\n'))
  return segs
}

function drawPoster() {
  const segs = posterSegments()
  if (!segs.length) { uni.showToast({ title: '先生成分析再保存', icon: 'none' }); return }
  const ctx = uni.createCanvasContext('poster')
  const marginX = 48, maxW = CW - marginX * 2
  const titleH = 40, lineH = 40, gapAfterTitle = 8, gapAfterBlock = 28
  // 第一遍：measure 各块折行、累加高度（measureText 需先设字号）。
  ctx.setFontSize(26)
  const laid = segs.map((s) => {
    ctx.setFontSize(26)
    return { title: s.title, lines: wrapLines(ctx, s.body, maxW) }
  })
  let y = 150   // 头部留白
  for (const b of laid) y += titleH + gapAfterTitle + b.lines.length * lineH + gapAfterBlock
  y += 80       // 底部留白
  CH.value = y
  // 等 canvas 尺寸生效再画（uni 需 nextTick）。
  nextTick(() => {
    const c = uni.createCanvasContext('poster')
    c.setFillStyle('#fffdf6'); c.fillRect(0, 0, CW, CH.value)
    c.setStrokeStyle('#f3ead3'); c.setLineWidth(2); c.strokeRect(16, 16, CW - 32, CH.value - 32)
    c.setTextAlign('left')
    c.setFillStyle('#2ea34a'); c.setFontSize(26); c.fillText('深度关系分析', marginX, 70)
    c.setFillStyle('#2f2b26'); c.setFontSize(44); c.fillText(displayName.value, marginX, 122)
    let yy = 150
    for (const b of laid) {
      c.setFillStyle('#4a72b8'); c.setFontSize(28); c.fillText(b.title, marginX, yy + 28)
      yy += titleH + gapAfterTitle
      c.setFillStyle('#4a443c'); c.setFontSize(26)
      for (const ln of b.lines) { c.fillText(ln, marginX, yy + 26); yy += lineH }
      yy += gapAfterBlock
    }
    c.setFillStyle('#9a917f'); c.setFontSize(22)
    c.fillText('本地生成 · 数据从未离开你的手机', marginX, CH.value - 40)
    c.draw(false, () => {
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
    })
  })
}
</script>

<template>
  <view class="page">
    <view v-if="!friend" class="empty">
      <view class="e-text">未找到该好友，返回好友页重试</view>
    </view>

    <template v-else>
      <!-- 头部 + 生成动作 -->
      <view class="head">
        <text class="h-name">{{ displayName }}</text>
        <text class="h-rel">{{ friend.rel }}</text>
        <text class="act" @click="generate">
          {{ loading ? '分析中…' : (deep ? '↻ 重新生成' : '✦ 生成深度关系分析') }}
        </text>
        <text v-if="stale" class="stale" @click="generate">数据已更新，点「重新生成」刷新</text>
        <text v-if="deep" class="act" @click="drawPoster">📥 保存长海报</text>
      </view>

      <view v-if="!deep" class="ph">点上方按钮，让 AI 从依恋、互动、需求、安全感等 10 个维度剖析你们的关系。</view>

      <template v-else>
        <!-- ① 整体评估 -->
        <view v-if="deep.overall" class="banner"><text class="b-t">整体评估</text><text class="b-body">{{ deep.overall }}</text></view>

        <!-- ② 依恋风格 + ③ 互动模式（双栏） -->
        <view class="row">
          <view v-if="deep.attachment" class="card col">
            <text class="c-t">依恋风格分析</text>
            <view v-if="deep.attachment.me" class="sub">
              <text class="s-h">我 · {{ deep.attachment.me.style }}</text>
              <text class="s-b">{{ deep.attachment.me.desc }}</text>
            </view>
            <view v-if="deep.attachment.other" class="sub">
              <text class="s-h">对方 · {{ deep.attachment.other.style }}</text>
              <text class="s-b">{{ deep.attachment.other.desc }}</text>
            </view>
          </view>
          <view v-if="deep.interaction" class="card col">
            <text class="c-t">互动模式分析</text>
            <view v-if="deep.interaction.initiative" class="sub"><text class="s-h">沟通主动性</text><text class="s-b">{{ deep.interaction.initiative }}</text></view>
            <view v-if="deep.interaction.expression" class="sub"><text class="s-h">情感表达</text><text class="s-b">{{ deep.interaction.expression }}</text></view>
            <view v-if="deep.interaction.conflict" class="sub"><text class="s-h">冲突处理</text><text class="s-b">{{ deep.interaction.conflict }}</text></view>
          </view>
        </view>

        <!-- ④ 情感需求 + ⑤ 关系独特性（双栏） -->
        <view class="row">
          <view v-if="deep.needs" class="card col">
            <text class="c-t">情感需求分析</text>
            <view v-if="deep.needs.me" class="sub"><text class="s-h">我的需求</text><text class="s-b">{{ deep.needs.me }}</text></view>
            <view v-if="deep.needs.other" class="sub"><text class="s-h">对方的需求</text><text class="s-b">{{ deep.needs.other }}</text></view>
          </view>
          <view v-if="deep.uniqueness" class="card col">
            <text class="c-t">关系独特性分析</text>
            <view v-if="deep.uniqueness.sharedMemory" class="sub"><text class="s-h">共同记忆</text><text class="s-b">{{ deep.uniqueness.sharedMemory }}</text></view>
            <view v-if="deep.uniqueness.ritual" class="sub"><text class="s-h">互动仪式</text><text class="s-b">{{ deep.uniqueness.ritual }}</text></view>
          </view>
        </view>

        <!-- ⑥ 安全感/信任曲线（通栏，带折线图） -->
        <view v-if="deep.security" class="card">
          <text class="c-t">安全感 / 信任曲线</text>
          <text v-if="deep.security.summary" class="s-b">{{ deep.security.summary }}</text>
          <canvas v-if="hasSecurityChart" canvas-id="secLine" class="sec-canvas" />
          <view v-for="(tp, i) in deep.security.turningPoints" :key="i" class="tp">
            <text v-if="tp.month || tp.direction" class="tp-m">{{ tp.month }}月 · {{ tp.direction }}</text>
            <text v-if="tp.event" class="tp-e">{{ tp.event }}</text>
          </view>
        </view>

        <!-- ⑦ 权力/主导权（通栏） -->
        <view v-if="deep.power" class="card">
          <text class="c-t">权力 / 主导权关系</text>
          <text v-if="deep.power.summary" class="s-b">{{ deep.power.summary }}</text>
          <view v-if="deep.power.whoLeads" class="sub"><text class="s-h">主导方</text><text class="s-b">{{ deep.power.whoLeads }}</text></view>
          <view v-if="deep.power.dependency" class="sub"><text class="s-h">依赖关系</text><text class="s-b">{{ deep.power.dependency }}</text></view>
        </view>

        <!-- ⑧ 情绪触发点（双栏） -->
        <view v-if="deep.triggers" class="row">
          <view v-if="deep.triggers.me" class="card col">
            <text class="c-t">我的情绪触发点</text>
            <view v-for="(t, i) in deep.triggers.me" :key="i" class="sub"><text class="s-h">{{ t.trigger }}</text><text class="s-b">{{ t.reaction }}</text></view>
          </view>
          <view v-if="deep.triggers.other" class="card col">
            <text class="c-t">对方的情绪触发点</text>
            <view v-for="(t, i) in deep.triggers.other" :key="i" class="sub"><text class="s-h">{{ t.trigger }}</text><text class="s-b">{{ t.reaction }}</text></view>
          </view>
        </view>

        <!-- ⑨ 沟通语言模式（通栏） -->
        <view v-if="deep.language" class="card">
          <text class="c-t">沟通语言模式</text>
          <view v-if="deep.language.appellation" class="sub"><text class="s-h">称呼</text><text class="s-b">{{ deep.language.appellation }}</text></view>
          <view v-if="deep.language.catchphrases" class="sub"><text class="s-h">口头禅</text><text class="s-b">{{ deep.language.catchphrases }}</text></view>
          <view v-if="deep.language.emoji" class="sub"><text class="s-h">表情包</text><text class="s-b">{{ deep.language.emoji }}</text></view>
          <view v-if="deep.language.latency" class="sub"><text class="s-h">回复时延</text><text class="s-b">{{ deep.language.latency }}</text></view>
        </view>

        <!-- ⑩ 优化建议（通栏，红问题/绿建议） -->
        <view v-if="deep.suggestions" class="card">
          <text class="c-t">优化建议</text>
          <view v-for="(sg, i) in deep.suggestions" :key="i" class="sug">
            <text v-if="sg.topic" class="sug-topic">{{ sg.topic }}</text>
            <view v-if="sg.problem" class="sug-p"><text class="tag tag-p">问题</text><text class="s-b">{{ sg.problem }}</text></view>
            <view v-if="sg.advice" class="sug-a"><text class="tag tag-a">建议</text><text class="s-b">{{ sg.advice }}</text></view>
          </view>
        </view>
      </template>
    </template>

    <canvas canvas-id="poster" class="offscreen" :style="{ width: CW + 'px', height: CH + 'px' }" />
  </view>
</template>

<style scoped>
.page { padding: 24rpx; background: #f6f7f5; min-height: 100vh; }
.empty, .ph { padding: 60rpx 24rpx; color: #8a8f99; font-size: 28rpx; text-align: center; }
.head { display: flex; flex-direction: column; gap: 8rpx; margin-bottom: 20rpx; }
.h-name { font-size: 40rpx; font-weight: 700; color: #2f2b26; }
.h-rel { font-size: 26rpx; color: #8a8f99; }
.act { align-self: flex-start; margin-top: 12rpx; padding: 12rpx 24rpx; background: #eafaef; color: #2ea34a; border-radius: 999rpx; font-size: 28rpx; }
.stale { color: #d08a2c; font-size: 24rpx; }
.banner { background: #eef3fb; border-left: 6rpx solid #5a8fd0; border-radius: 12rpx; padding: 24rpx; margin-bottom: 20rpx; }
.b-t { display: block; color: #4a72b8; font-weight: 700; font-size: 30rpx; margin-bottom: 12rpx; }
.b-body { font-size: 28rpx; line-height: 1.7; color: #3a4657; }
.row { display: flex; gap: 16rpx; margin-bottom: 20rpx; }
.col { flex: 1; }
.card { background: #fff; border-radius: 14rpx; padding: 24rpx; margin-bottom: 20rpx; }
.c-t { display: block; color: #2ea34a; font-weight: 700; font-size: 30rpx; margin-bottom: 14rpx; }
.sub { margin-bottom: 14rpx; }
.s-h { display: block; color: #5a8fd0; font-size: 26rpx; font-weight: 600; margin-bottom: 4rpx; }
.s-b { font-size: 27rpx; line-height: 1.7; color: #4a443c; }
.sec-canvas { width: 100%; height: 200rpx; margin: 16rpx 0; }
.tp { display: flex; flex-direction: column; padding: 12rpx 0; border-top: 1rpx solid #f0f0ee; }
.tp-m { font-size: 25rpx; color: #d08a2c; }
.tp-e { font-size: 26rpx; color: #4a443c; }
.sug { padding: 16rpx 0; border-top: 1rpx solid #f0f0ee; }
.sug-topic { display: block; font-weight: 600; font-size: 28rpx; color: #2f2b26; margin-bottom: 10rpx; }
.sug-p, .sug-a { display: flex; gap: 10rpx; margin-bottom: 8rpx; }
.tag { flex: none; padding: 2rpx 12rpx; border-radius: 6rpx; font-size: 22rpx; height: 34rpx; line-height: 30rpx; }
.tag-p { background: #fdecec; color: #d05a5a; }
.tag-a { background: #eafaef; color: #2ea34a; }
.offscreen { position: fixed; left: -9999px; top: 0; }
</style>
